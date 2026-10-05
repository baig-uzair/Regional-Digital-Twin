"""SMHI Open Data - meteorological observations (air temperature, station Borlänge flygplats).

Unlike the regional connectors this one yields a single observation, not NormalizedRecords:
it is stored in regional_telemetry (and mirrored to Orion-LD) by app/jobs.py. It never
returns a made-up value: on any failure it raises ConnectorError and nothing is written.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import requests

from .common import ConnectorError

STATION_ID = "105260"  # Borlänge flygplats
ENTITY_ID = "urn:ngsi-ld:WeatherObserved:Dalarna:SMHI:105260"
LON, LAT = 15.5133, 60.4219
URL = f"https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/1/station/{STATION_ID}/period/latest-hour/data.json"
HEADERS = {"User-Agent": "DalarnaDigitalTwin/1.0 (Research; Sweden)"}
TIMEOUT = 10


@dataclass
class Observation:
    temperature: float
    observed_at: datetime
    entity_id: str = ENTITY_ID
    lon: float = LON
    lat: float = LAT


def fetch_observation() -> Observation:
    try:
        resp = requests.get(URL, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"SMHI: request failed: {exc}")
    if resp.status_code != 200:
        raise ConnectorError(f"SMHI: HTTP {resp.status_code} from {URL}")
    try:
        values = resp.json().get("value") or []
    except ValueError as exc:
        raise ConnectorError(f"SMHI: response was not JSON: {exc}")
    if not values:
        raise ConnectorError("SMHI: response contained no observation")
    last = values[-1]
    try:
        temperature = float(last["value"])
        observed_at = datetime.fromtimestamp(int(last["date"]) / 1000, tz=timezone.utc)
    except (KeyError, TypeError, ValueError) as exc:
        raise ConnectorError(f"SMHI: unexpected observation shape: {exc}")
    return Observation(temperature=temperature, observed_at=observed_at)
