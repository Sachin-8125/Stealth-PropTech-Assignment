import { createFileRoute } from '@tanstack/react-router'
import '../styles.css'
import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { getSnapshot, pathId, paymentKey, request, type Snapshot } from '../api.ts'

export const Route = createFileRoute('/')({
  component: Home,
})

const cents = (amount: number) => `${amount.toLocaleString('en-US')}¢`
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

type Scope = { controller: AbortController; busy: boolean }

function Home() {
  const scope = useRef<Scope>({ controller: new AbortController(), busy: false })
  const [homeId, setHomeId] = useState('')
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [homeName, setHomeName] = useState('')
  const [openId, setOpenId] = useState('')
  const [memberName, setMemberName] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    scope.current = { controller: new AbortController(), busy: false }
    return () => scope.current.controller.abort()
  }, [])

  const isCurrent = (current: Scope) =>
    scope.current === current && !current.controller.signal.aborted

  const disabled = Boolean(busy) || loading

  const totalOutstanding =
    data?.balances.reduce((sum, balance) => sum + balance.outstandingCents, 0) ?? 0

  async function refresh(id: string, current: Scope) {
    setLoading(true)
    try {
      const snapshot = await getSnapshot(id, current.controller.signal)
      if (isCurrent(current)) setData(snapshot)
    } finally {
      if (isCurrent(current)) setLoading(false)
    }
  }

  async function run(label: string, action: (current: Scope) => Promise<void>) {
    const current = scope.current
    if (current.busy) return
    current.busy = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await action(current)
    } catch (cause) {
      if (isCurrent(current)) setError(message(cause))
    } finally {
      if (isCurrent(current)) {
        current.busy = false
        setBusy('')
      }
    }
  }

  function createHome(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    void run('Creating home', async (current) => {
      const home = await request<{ id: string; name: string }>(
        '/homes',
        current.controller.signal,
        { name: homeName.trim() },
      )
      if (!isCurrent(current)) return
      setHomeName('')
      setHomeId(home.id)
      setOpenId(home.id)
      setData(null)
      await refresh(home.id, current)
      if (isCurrent(current)) setNotice('Home created. Add your first member below.')
    })
  }

  function openHome(id: string) {
    scope.current.controller.abort()
    const current: Scope = { controller: new AbortController(), busy: false }
    scope.current = current
    setHomeId(id)
    setData(null)
    setMemberName('')
    setTitle('')
    setAmount('')
    setBusy('')
    void run('Opening home', () => refresh(id, current))
  }

  function addMember(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    void run('Adding member', async (current) => {
      await request(`/homes/${pathId(homeId)}/members`, current.controller.signal, {
        name: memberName.trim(),
      })
      if (!isCurrent(current)) return
      setMemberName('')
      setNotice('Member added. Refreshing the home…')
      await refresh(homeId, current)
      if (isCurrent(current)) setNotice('Member added. New bills will include them.')
    })
  }

  function createBill(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const totalCents = Number(amount)
    if (!/^\d+$/.test(amount) || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
      setError('Enter a positive whole number of cents, such as 1000.')
      return
    }
    void run('Creating bill', async (current) => {
      await request(`/homes/${pathId(homeId)}/bills`, current.controller.signal, {
        title: title.trim(),
        totalCents,
      })
      if (!isCurrent(current)) return
      setTitle('')
      setAmount('')
      setNotice('Bill created. Refreshing the home…')
      await refresh(homeId, current)
      if (isCurrent(current)) setNotice('Bill created and split between the current members.')
    })
  }

  function pay(billId: string, shareId: string) {
    void run(`pay:${shareId}`, async (current) => {
      await request(
        `/bills/${pathId(billId)}/shares/${pathId(shareId)}/pay`,
        current.controller.signal,
        undefined,
        paymentKey(billId, shareId),
      )
      if (!isCurrent(current)) return
      setNotice('Payment confirmed by the server. Refreshing balances…')
      await refresh(homeId, current)
      if (isCurrent(current)) setNotice('Share paid. Balances are up to date.')
    })
  }

  return (
    <main className="app">
      {/* header section */}
      <header className="masthead">
        <a className="brand" href="/" aria-label="Household bill splitter home">
          <span className="brand-mark">h.</span> household
        </a>
        <span className="tag">Shared home. Clear balances.</span>
      </header>

      {/* intro section */}
      <section className="intro">
        <span className="eyebrow">A LITTLE LESS WHO OWES WHAT</span>
        <h1>
          Split fairly.
          <br />
          <span>Live together easily.</span>
        </h1>
        <p>One place for your home's bills, everyone's shares, and what you owe.</p>
      </section>

      {/* entry section */}
      <section className="entry-grid" aria-label="Choose a home">
        <form className="panel entry" onSubmit={createHome}>
          <h2>Start a home</h2>
          <label htmlFor="home-name">Home name</label>
          <div className="input-row">
            <input
              id="home-name"
              required
              maxLength={120}
              value={homeName}
              onChange={(event) => setHomeName(event.target.value)}
              placeholder="e.g. The Maple House"
            />
            <button disabled={disabled || !homeName.trim()} type="submit">
              {busy === 'Creating home' ? 'Creating…' : 'Create home'}
            </button>
          </div>
        </form>
        <form
          className="panel entry"
          onSubmit={(event) => {
            event.preventDefault()
            openHome(openId.trim())
          }}
        >
          <h2>Already have a home?</h2>
          <label htmlFor="home-id">Home ID</label>
          <div className="input-row">
            <input
              id="home-id"
              required
              value={openId}
              onChange={(event) => setOpenId(event.target.value)}
              placeholder="Paste your home ID"
            />
            <button className="secondary" disabled={!openId.trim()} type="submit">
              Open home
            </button>
          </div>
        </form>
      </section>
      {error && (
        <div className="alert" role="alert">
          <strong>We couldn’t finish that.</strong> {error}{' '}
          {homeId && (
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => void run('Refreshing', (current) => refresh(homeId, current))}
              type="button"
            >
              Refresh home
            </button>
          )}
        </div>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {loading && (
        <p className="loading" role="status">
          Loading your home, bills and balances…
        </p>
      )}

      {!homeId && (
        <div className="welcome">
          <span className="welcome-symbol">↗</span>
          <h2>Every shared home starts here.</h2>
          <p>Create a home, add your people, then split your first bill.</p>
        </div>
      )}

      {data && (
        <section className="workspace" aria-label="Your home" aria-busy={loading}>
          <div className="home-heading">
            <div>
              <span className="eyebrow">YOUR HOME</span>
              <h2>{data.home.name}</h2>
              <p className="home-id">
                Home ID: <code>{data.home.id}</code>
              </p>
            </div>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void run('Refreshing', (current) => refresh(homeId, current))}
              type="button"
            >
              {busy === 'Refreshing' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div className="workspace-grid">
            <aside className="sidebar">
              <section className="panel">
                <div className="section-heading">
                  <h3>People & balances</h3>
                  <span className="count">{data.home.members.length}</span>
                </div>
                <p className="muted">In the order they joined the home.</p>
                {data.balances.length === 0 ? (
                  <p className="empty-small">
                    No members yet. Add someone to start splitting bills.
                  </p>
                ) : (
                  <ol className="balances">
                    {data.balances.map((balance, index) => (
                      <li key={balance.memberId}>
                        <span className="avatar">{index + 1}</span>
                        <span className="member-name">{balance.name}</span>
                        <strong>{cents(balance.outstandingCents)}</strong>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="balance-total">
                  <span>Total outstanding</span>
                  <strong>{cents(totalOutstanding)}</strong>
                </div>
                <form className="stack-form" onSubmit={addMember}>
                  <label htmlFor="member-name">Add a member</label>
                  <input
                    id="member-name"
                    required
                    maxLength={120}
                    value={memberName}
                    onChange={(event) => setMemberName(event.target.value)}
                    placeholder="Member’s name"
                  />
                  <button
                    className="secondary"
                    disabled={disabled || !memberName.trim()}
                    type="submit"
                  >
                    {busy === 'Adding member' ? 'Adding…' : 'Add member'}
                  </button>
                </form>
              </section>
              <p className="footnote">
                Uneven split? Extra cents go to the earliest members first. Existing bills keep
                their original shares.
              </p>
            </aside>
            <div className="bills-column">
              <section className="panel">
                <h3>Add a shared bill</h3>
                <form className="bill-form" onSubmit={createBill}>
                  <div>
                    <label htmlFor="bill-title">Bill title</label>
                    <input
                      id="bill-title"
                      required
                      maxLength={200}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="e.g. Weekly groceries"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-amount">Total in cents</label>
                    <input
                      id="bill-amount"
                      required
                      inputMode="numeric"
                      pattern="[0-9]+"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="1000"
                      aria-describedby="amount-help"
                    />
                  </div>
                  <button
                    disabled={
                      disabled || data.home.members.length === 0 || !title.trim() || !amount
                    }
                    type="submit"
                  >
                    {busy === 'Creating bill' ? 'Splitting…' : 'Split bill'}
                  </button>
                </form>
                <p className="muted" id="amount-help">
                  100 cents = 1 dollar. Positive whole cents only.
                  {data.home.members.length === 0
                    ? ' Add a member before creating a bill.'
                    : ' Split equally among current members.'}
                </p>
              </section>
              <div className="section-heading bills-heading">
                <h3>Bills & shares</h3>
                <span className="count">{data.bills.length}</span>
              </div>
              {data.bills.length === 0 ? (
                <div className="panel empty-bills">
                  <h3>A fresh start.</h3>
                  <p>No bills yet. Add your first shared expense above.</p>
                </div>
              ) : (
                data.bills.map((bill) => (
                  <article className="panel bill" key={bill.id}>
                    <div className="bill-heading">
                      <div>
                        <h3>{bill.title}</h3>
                        <p className="muted">
                          {bill.shares.filter((share) => share.paidAt !== null).length} of{' '}
                          {bill.shares.length} shares paid
                        </p>
                      </div>
                      <strong className="bill-total">{cents(bill.totalCents)}</strong>
                    </div>
                    <ul className="shares">
                      {bill.shares.map((share) => (
                        <li key={share.id}>
                          <div className="share-person">
                            <strong>
                              {data.home.members.find((member) => member.id === share.memberId)
                                ?.name ?? share.memberId}
                            </strong>
                            <span className="muted">{cents(share.amountCents)}</span>
                          </div>
                          {share.paidAt !== null ? (
                            <span className="paid">Paid</span>
                          ) : (
                            <button
                              className="pay-button"
                              disabled={disabled}
                              type="button"
                              onClick={() => pay(bill.id, share.id)}
                              aria-label={`Pay ${data.home.members.find((member) => member.id === share.memberId)?.name ?? 'member'}’s share of ${bill.title}`}
                            >
                              {busy === `pay:${share.id}` ? 'Paying…' : 'Pay share'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      <footer>Made for the home you share. All amounts shown in whole cents.</footer>
    </main>
  )
}
