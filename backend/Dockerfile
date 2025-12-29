FROM python:3.11-slim

ENV PORT=8000 \
    DB_PATH=/data/app.db \
    FRONTEND_ORIGIN=http://localhost:4173 \
    APP_SECRET=dev-secret

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8000
CMD ["python", "app.py"]
