import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

type Home = { id: string; name: string }
type Member = { id: string; homeId: string; name: string }
type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number }
type Payment = Share & { paymentKey: string | null }

const app = new Hono<{ Bindings: Env }>()
const shareColumns = 'id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'Expected a JSON object' })
  }
  return body as Record<string, unknown>
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HTTPException(422, { message: `${field} must contain 1–${max} characters` })
  }
  return value.trim()
}

async function findHome(db: D1DatabaseSession, id: string): Promise<Home> {
  const home = await db.prepare('SELECT id, name FROM homes WHERE id = ?').bind(id).first<Home>()
  if (!home) throw new HTTPException(404, { message: 'Home not found' })
  return home
}

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})
app.notFound((c) => c.json({ error: 'Route not found' }, 404))
app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await readBody(c.req.raw)
  const home = { id: crypto.randomUUID(), name: text(body.name, 'Name', 120) }
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(home.id, home.name)
    .run()
  return c.json(home, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const db = c.env.DB.withSession('first-primary')
  const home = await findHome(db, c.req.param('homeId'))
  const members = await db
    .prepare('SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY sequence')
    .bind(home.id)
    .all<Member>()
  return c.json({ ...home, members: members.results })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const db = c.env.DB.withSession('first-primary')
  const homeId = c.req.param('homeId')
  await findHome(db, homeId)
  const body = await readBody(c.req.raw)
  const member = { id: crypto.randomUUID(), homeId, name: text(body.name, 'Name', 120) }
  await db
    .prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(member.id, homeId, member.name)
    .run()
  return c.json(member, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB.withSession('first-primary')
  const homeId = c.req.param('homeId')
  await findHome(db, homeId)
  const body = await readBody(c.req.raw)
  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'Total must be a positive safe integer in cents' }, 422)
  }
  const bill = {
    id: crypto.randomUUID(),
    homeId,
    title: text(body.title, 'Title', 200),
    totalCents,
  }
  const results = await db.batch([
    db
      .prepare(`INSERT INTO bills (id, home_id, title, total_cents)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM members WHERE home_id = ?)`)
      .bind(bill.id, homeId, bill.title, totalCents, homeId),
    db
      .prepare(`INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents)
      SELECT lower(hex(randomblob(16))), ?, home_id, id,
        (CAST(? AS INTEGER) / COUNT(*) OVER ()) + CASE WHEN ROW_NUMBER() OVER (ORDER BY sequence) <=
        (CAST(? AS INTEGER) % COUNT(*) OVER ()) THEN 1 ELSE 0 END
      FROM members WHERE home_id = ?`)
      .bind(bill.id, totalCents, totalCents, homeId),
    db
      .prepare(`SELECT ${shareColumns} FROM shares WHERE bill_id = ?
      ORDER BY (SELECT sequence FROM members WHERE members.id = shares.member_id)`)
      .bind(bill.id),
  ])
  if (!results[0]?.meta.changes) return c.json({ error: 'Home has no members' }, 422)
  return c.json({ ...bill, shares: results[2]?.results as Share[] }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB.withSession('first-primary')
  const homeId = c.req.param('homeId')
  await findHome(db, homeId)
  const results = await db.batch([
    db
      .prepare(`SELECT id, home_id AS homeId, title, total_cents AS totalCents
      FROM bills WHERE home_id = ? ORDER BY sequence`)
      .bind(homeId),
    db
      .prepare(`SELECT s.id, s.bill_id AS billId, s.member_id AS memberId,
      s.amount_cents AS amountCents, s.paid_at AS paidAt FROM shares s
      JOIN members m ON m.id = s.member_id WHERE s.home_id = ? ORDER BY m.sequence`)
      .bind(homeId),
  ])
  const sharesByBill = new Map<string, Share[]>()
  for (const row of (results[1]?.results ?? []) as (Share & { billId: string })[]) {
    const { billId, ...share } = row
    const shares = sharesByBill.get(billId) ?? []
    shares.push(share)
    sharesByBill.set(billId, shares)
  }
  return c.json({
    bills: ((results[0]?.results ?? []) as Bill[]).map((bill) => ({
      ...bill,
      shares: sharesByBill.get(bill.id) ?? [],
    })),
  })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')
  if (!key?.trim()) return c.json({ error: 'Idempotency-Key is required' }, 400)
  const db = c.env.DB.withSession('first-primary')
  const { billId, shareId } = c.req.param()
  const paid = await db
    .prepare(`UPDATE shares SET paid_at = ?, payment_key = ?
    WHERE id = ? AND bill_id = ? AND paid_at IS NULL RETURNING ${shareColumns}`)
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<Share>()
  if (paid) return c.json(paid)
  const existing = await db
    .prepare(`SELECT ${shareColumns}, payment_key AS paymentKey
    FROM shares WHERE id = ? AND bill_id = ?`)
    .bind(shareId, billId)
    .first<Payment>()
  if (!existing) return c.json({ error: 'Bill or share not found' }, 404)
  if (existing.paymentKey !== key) {
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }
  const { paymentKey: _, ...share } = existing
  return c.json(share)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const db = c.env.DB.withSession('first-primary')
  const homeId = c.req.param('homeId')
  await findHome(db, homeId)
  const balances = await db
    .prepare(`SELECT m.id AS memberId, m.name,
    COALESCE(SUM(s.amount_cents), 0) AS outstandingCents FROM members m
    LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
    WHERE m.home_id = ? GROUP BY m.sequence ORDER BY m.sequence`)
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()
  return c.json({ balances: balances.results })
})

export default app