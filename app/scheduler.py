"""Registry-driven scheduler.

One light loop re-reads source_registry every few seconds, so intervals and enable/disable
changes made through Save & Apply take effect without a restart. Due sources run on a small
thread pool. Last-attempt times come from source_runs, so a container restart does not
re-hit every external API at once.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app import config, db, jobs

logger = logging.getLogger("app.scheduler")

TICK_SECONDS = 5
ERROR_RETRY_SECONDS = 300


def missing_config(auth_env_vars: list[str]) -> list[str]:
    return [n for n in auth_env_vars if not config.env_is_set(n)]


class Scheduler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="source")
        self._inflight: set[str] = set()
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="scheduler", daemon=True)
        self._thread.start()
        logger.info("scheduler started")

    def stop(self) -> None:
        self._stop.set()
        self._pool.shutdown(wait=False, cancel_futures=True)

    @property
    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:  # noqa: BLE001
                logger.exception("scheduler tick failed")
            self._stop.wait(TICK_SECONDS)

    def due_sources(self, now: datetime | None = None) -> list[dict]:
        now = now or datetime.now(timezone.utc)
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.connector, r.interval_seconds, r.auth_env_vars,
                       (SELECT started_at FROM source_runs s WHERE s.source_id = r.id AND s.trigger <> 'test'
                         ORDER BY started_at DESC LIMIT 1) AS last_started,
                       (SELECT status FROM source_runs s WHERE s.source_id = r.id AND s.trigger <> 'test'
                         ORDER BY started_at DESC LIMIT 1) AS last_status
                FROM source_registry r WHERE r.enabled
                """
            )
            rows = cur.fetchall()
        due = []
        for r in rows:
            if missing_config(r["auth_env_vars"] or []):
                continue  # "Not configured": nothing to run, nothing written
            if r["last_started"] is None:
                due.append(r)
                continue
            wait = r["interval_seconds"]
            if r["last_status"] == "error":
                wait = min(wait, ERROR_RETRY_SECONDS)
            if (now - r["last_started"]).total_seconds() >= wait:
                due.append(r)
        return due

    def tick(self) -> None:
        for r in self.due_sources():
            with self._lock:
                if r["id"] in self._inflight:
                    continue
                self._inflight.add(r["id"])
            self._pool.submit(self._run, r["id"], r["connector"])

    def _run(self, source_id: str, connector: str) -> None:
        try:
            jobs.run_source(source_id, connector, trigger="schedule")
        finally:
            with self._lock:
                self._inflight.discard(source_id)


scheduler = Scheduler()
