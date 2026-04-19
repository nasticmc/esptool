FROM python:3.12-slim

WORKDIR /app

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
