import { createFileRoute } from '@tanstack/react-router'
import '../styles.css'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
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
          <br/>
          <span>Live together easily.</span>
        </h1>
        <p>One place for your home's bills, everyone's shares, and what you owe.</p>
      </section>

    </main>
  )
}
