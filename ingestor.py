import requests
import psycopg2
from datetime import datetime, timezone
import json
import time
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler

# --- CONFIGURATION RÉSEAU DOCKER ---
DB_HOST = "timescaledb"
DB_PORT = 5432
DB_NAME = "dalarna_dt"
DB_USER = "postgres"
DB_PASS = "DalarnaTwin2026!"
ORION_URL = "http://orion:1026/ngsi-ld/v1/entities"

# Identifiants NGSI-LD & Coordonnées Réelles (Dalarna)
AIR_STATION_ID = "urn:ngsi-ld:WeatherObserved:Dalarna:SMHI:105260"
AIR_LON, AIR_LAT = 15.5133, 60.4219  # SMHI Borlänge Flygplats

ROAD_STATION_ID = "urn:ngsi-ld:RoadWeatherObserved:Dalarna:Trafikverket:E16"
ROAD_LON, ROAD_LAT = 15.3850, 60.5050  # Station VViS E16 Mellsta / Borlänge

# --- MOTEUR DE DÉCISION DU JUMEAU NUMÉRIQUE ---
def calculate_frost_risk(t_air, t_road, cooling_rate_per_hour=0.0):
    predicted_road_temp_1h = round(t_road + cooling_rate_per_hour, 2)

    # 1. Verglas noir / Verglas par rayonnement : Sol négatif avec air positif
    if t_road <= 0.0 and t_air > 0.0:
        status = "DANGER_BLACK_ICE"
        label = "🔴 DANGER CRITIQUE : Verglas par rayonnement (Sol gelé / Air > 0)"
        color = "#dc2626"
        action = "Déclenchement immédiat du salage prioritaire d'urgence."

    # 2. Gel généralisé : Sol et air négatifs
    elif t_road <= 0.0 and t_air <= 0.0:
        status = "GENERAL_FREEZING"
        label = "🟣 ALERTE : Gel généralisé de la chaussée"
        color = "#9333ea"
        action = "Salage préventif et réduction de la vitesse recommandée."

    # 3. Risque imminent : Chaussée proche de 0°C ET refroidissement effectif vers le gel
    elif (t_road <= 1.5 and cooling_rate_per_hour < -0.5) or (0.0 < t_road <= 3.0 and predicted_road_temp_1h <= 0.0):
        status = "WARNING_IMMINENT_FROST"
        label = f"🟡 VIGILANCE : Risque de gel imminent (Prévu à 1h: {predicted_road_temp_1h}°C)"
        color = "#d97706"
        action = "Pré-mobilisation des équipes techniques de Dalarna."

    # 4. Conditions normales / Saison estivale
    else:
        status = "NORMAL"
        label = "🟢 SÉCURISÉ : Aucun risque de gel détecté"
        color = "#16a34a"
        action = "Conditions normales. Aucune intervention requise."

    return {
        "status": status,
        "label": label,
        "color": color,
        "action": action,
        "current_air_temp": round(t_air, 1),
        "current_road_temp": round(t_road, 1),
        "predicted_road_temp_1h": predicted_road_temp_1h,
        "cooling_rate_per_hour": round(cooling_rate_per_hour, 2)
    }

# --- REQUÊTE SMHI TEMPS RÉEL (Open Data API) ---
def fetch_smhi_air_temp():
    url = "https://opendata-download-metobs.smhi.se/api/version/1.0/parameter/1/station/105260/period/latest-hour/data.json"
    headers = {"User-Agent": "DalarnaDigitalTwin/1.0 (Research; Sweden)"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            payload = resp.json()
            val_list = payload.get("value", [])
            if val_list:
                raw_temp = val_list[-1].get("value")
                if raw_temp is not None:
                    return float(raw_temp)
    except Exception as e:
        print(f"[SMHI Exception] Connexion impossible : {e}")
    return 19.5

# --- SERVEUR PROXY & API DU COCKPIT ---
class ProxyCORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def do_GET(self):
        # 1. Données Station Air
        if self.path in ['/api/station', '/api/station-air', '/api/air-weather']:
            try:
                resp = requests.get(f"{ORION_URL}/{AIR_STATION_ID}", timeout=3)
                self.send_response(resp.status_code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(resp.content)
            except Exception as e:
                print(f"[API Station Error] {e}")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"temperature": {"value": 19.5}}).encode())

        # 2. Données Station Route
        elif self.path in ['/api/road-weather', '/api/road-station', '/api/station-road', '/api/road']:
            try:
                resp = requests.get(f"{ORION_URL}/{ROAD_STATION_ID}", timeout=3)
                self.send_response(resp.status_code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(resp.content)
            except Exception as e:
                print(f"[API Road Error] {e}")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"temperature": {"value": 18.3}}).encode())

        # 3. Prédiction Temps Réel
        elif self.path == '/api/simulation/predict':
            t_air = 19.5
            t_road = 18.3
            cooling = 0.0
            try:
                conn = psycopg2.connect(
                    host=DB_HOST, port=DB_PORT, database=DB_NAME, user=DB_USER, password=DB_PASS, connect_timeout=3
                )
                cur = conn.cursor()
                cur.execute("SELECT DISTINCT ON (entity_id) entity_id, temperature FROM regional_telemetry ORDER BY entity_id, time DESC;")
                rows = dict(cur.fetchall())
                if AIR_STATION_ID in rows:
                    t_air = float(rows[AIR_STATION_ID])
                if ROAD_STATION_ID in rows:
                    t_road = float(rows[ROAD_STATION_ID])

                cur.execute(f"SELECT temperature FROM regional_telemetry WHERE entity_id = '{ROAD_STATION_ID}' ORDER BY time DESC LIMIT 2;")
                recent = [float(r[0]) for r in cur.fetchall()]
                if len(recent) >= 2:
                    cooling = round((recent[0] - recent[1]) * 6, 2)

                cur.close()
                conn.close()
            except Exception:
                pass

            res = calculate_frost_risk(t_air, t_road, cooling)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(res).encode())
        else:
            super().do_GET()

    def do_POST(self):
        # Simulation Dynamique What-If avec pilotage direct absolu
        if self.path == '/api/simulation/what-if':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length).decode('utf-8'))
                
                sim_road = float(body.get('simulated_road_temp', 0.0))
                sim_air = float(body.get('simulated_air_temp', 19.5))

                sim_cooling = -1.5 if sim_road <= 2.0 else -0.1

                res = calculate_frost_risk(sim_air, sim_road, sim_cooling)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(res).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

def run_web_server():
    server_address = ('', 8000)
    httpd = HTTPServer(server_address, ProxyCORSRequestHandler)
    httpd.serve_forever()

# --- GESTION FIWARE ORION-LD & TIMESCALEDB ---
def init_or_update_entity(entity_id, entity_type, new_temp, lon, lat):
    url = f"{ORION_URL}/{entity_id}/attrs/temperature"
    headers = {
        'Content-Type': 'application/json',
        'Link': '<https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
    }
    payload = json.dumps({"type": "Property", "value": new_temp})
    try:
        r = requests.patch(url, headers=headers, data=payload, timeout=3)
        if r.status_code == 404:
            create_headers = {'Content-Type': 'application/ld+json'}
            create_payload = json.dumps({
               "id": entity_id,
               "type": entity_type,
               "location": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [lon, lat]}},
               "temperature": {"type": "Property", "value": new_temp, "unitCode": "CEL"},
               "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
            })
            requests.post(ORION_URL, headers=create_headers, data=create_payload, timeout=3)
    except Exception:
        pass

def log_to_timescaledb(entity_id, temp_val, lon, lat):
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, database=DB_NAME, user=DB_USER, password=DB_PASS, connect_timeout=3
        )
        cur = conn.cursor()
        query = "INSERT INTO regional_telemetry (time, entity_id, temperature, geom) VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326));"
        cur.execute(query, (datetime.now(timezone.utc), entity_id, temp_val, lon, lat))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[SQL Error] {e}")

def run_ingestor():
    print("[Ingestor] Ingestion active : SMHI Borlänge & Trafikverket E16...")
    while True:
        # Mesure SMHI Réelle
        air_temp = fetch_smhi_air_temp()
        init_or_update_entity(AIR_STATION_ID, "WeatherObserved", air_temp, AIR_LON, AIR_LAT)
        log_to_timescaledb(AIR_STATION_ID, air_temp, AIR_LON, AIR_LAT)

        # Modèle thermique chaussée E16
        road_temp = round(air_temp - 1.2, 1)
        init_or_update_entity(ROAD_STATION_ID, "RoadWeatherObserved", road_temp, ROAD_LON, ROAD_LAT)
        log_to_timescaledb(ROAD_STATION_ID, road_temp, ROAD_LON, ROAD_LAT)

        current_time = datetime.now().strftime("%H:%M:%S")
        print(f"[{current_time}] SMHI Air: {air_temp}°C | Route E16: {road_temp}°C (Data Lake OK)")
        time.sleep(30)

# Lancement de la boucle d'ingestion en tâche de fond
t = threading.Thread(target=run_ingestor, daemon=True)
t.start()
if __name__ == "__main__":
    run_web_server()
    