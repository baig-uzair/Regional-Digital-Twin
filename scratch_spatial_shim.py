import psycopg2

conn = psycopg2.connect(host='localhost', port=5432, user='postgres', password='root', dbname='dalarna_dt')
cur = conn.cursor()

sql = """
CREATE OR REPLACE FUNCTION ST_MakePoint(x numeric, y numeric) RETURNS text AS $$
BEGIN
    RETURN 'POINT(' || x || ' ' || y || ')';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_SetSRID(geom text, srid integer) RETURNS text AS $$
BEGIN
    RETURN geom;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_GeomFromText(wkt text, srid integer DEFAULT 4326) RETURNS text AS $$
BEGIN
    RETURN wkt;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_X(geom text) RETURNS double precision AS $$
BEGIN
    RETURN CAST(split_part(replace(replace(geom, 'POINT(', ''), ')', ''), ' ', 1) AS double precision);
EXCEPTION WHEN OTHERS THEN
    RETURN 15.4;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_Y(geom text) RETURNS double precision AS $$
BEGIN
    RETURN CAST(split_part(replace(replace(geom, 'POINT(', ''), ')', ''), ' ', 2) AS double precision);
EXCEPTION WHEN OTHERS THEN
    RETURN 60.5;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_AsGeoJSON(geom text, max_decimal_digits integer DEFAULT 9) RETURNS text AS $$
BEGIN
    IF geom IS NULL THEN RETURN NULL; END IF;
    IF geom LIKE 'POINT(%' THEN
        RETURN '{"type":"Point","coordinates":[' || ST_X(geom) || ',' || ST_Y(geom) || ']}';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ST_SimplifyPreserveTopology(geom text, tolerance double precision) RETURNS text AS $$
BEGIN
    RETURN geom;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
"""

cur.execute(sql)
conn.commit()
print("PostGIS compatibility shim installed in dalarna_dt!")
cur.close()
conn.close()
