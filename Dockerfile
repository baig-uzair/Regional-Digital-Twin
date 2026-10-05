FROM python:3.11-slim

# Répertoire de travail dans le conteneur
WORKDIR /app

# Copie des dépendances et installation
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du script et des fichiers web
COPY ingestor.py .
COPY index.html .
COPY datasource_store.py .
COPY connector_runner.py .
COPY verify_sources.py .
COPY connectors/ ./connectors/
COPY db/ ./db/

# Exposer le port du serveur proxy local
EXPOSE 8000

# Lancement du script
CMD ["python", "ingestor.py"]