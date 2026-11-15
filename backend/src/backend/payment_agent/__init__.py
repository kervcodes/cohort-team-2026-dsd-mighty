"""The payment agent (DC-84): pays an approved bill on the vendor's payment
portal for a queued payment run.

- `agent.run_payment(run_id)`: the Claude tool-use loop for one run.
- `tools.py`: the tools Claude may call and every safety check behind them.
- `portal.py`: the portal driver interface; `playwright_portal.py` drives the
  demo portals with headless Chromium.
- `worker.py`: `python -m backend.payment_agent.worker [--once]`.
"""
