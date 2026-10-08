# Frontend — underwriter UI

Underwriter-facing app (readable in under two minutes):

- Intake form with source tags (`extracted` / `geocoded` / `dem` / `class_default` / `human`)
- Map pin when GPS is missing after geocode
- Hazard / damage / EP curve
- Loud **synthetic / proxy** labels
- Confirm-or-edit blockers (construction class, TIV, coverage subject)

Talks to the [backend](../backend/) API. Broker PDF/DOCX upload goes to the [agent](../agent/).

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
