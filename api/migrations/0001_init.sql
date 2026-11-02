CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_valid CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE TABLE members (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT members_identity UNIQUE (id, home_id),
  CONSTRAINT members_name_valid CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE TABLE bills (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT bills_identity UNIQUE (id, home_id),
  CONSTRAINT bills_title_valid CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CONSTRAINT bills_total_valid CHECK (
    typeof(total_cents) = 'integer' AND total_cents BETWEEN 1 AND 9007199254740991
  )
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  payment_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id, home_id) REFERENCES bills(id, home_id),
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id, home_id) REFERENCES members(id, home_id),
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_amount_valid CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT shares_payment_valid CHECK (
    (paid_at IS NULL AND payment_key IS NULL) OR
    (paid_at IS NOT NULL AND payment_key IS NOT NULL AND length(trim(payment_key)) > 0)
  )
);

CREATE INDEX members_home_order ON members(home_id, sequence);
CREATE INDEX bills_home_order ON bills(home_id, sequence);
CREATE INDEX shares_member_unpaid ON shares(member_id) WHERE paid_at IS NULL;