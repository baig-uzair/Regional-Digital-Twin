from fastapi import APIRouter, HTTPException, Query

from app import geo, municipalities, sources

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/datasources/summary")
def datasources_summary():
    return sources.summary()


@router.get("/datasources")
def datasources(source: str = Query(..., min_length=1, max_length=64)):
    return sources.features_geojson(source)


@router.get("/municipalities")
def list_municipalities():
    items = municipalities.all_municipalities()
    return {"data_year": municipalities.current_year(items), "municipalities": items}


@router.get("/municipalities/{code}")
def get_municipality(code: str):
    if code not in geo.codes():
        raise HTTPException(status_code=404, detail=f"Unknown municipality code '{code}'")
    return municipalities.one(code)
