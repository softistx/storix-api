# The backup image: the official mongo image (mongodump, mongorestore, GNU date)
# with `mc` copied in from the pinned minio-client build. Shell scripts are the
# one thing available inside a container, so these stay as files here.
FROM cgr.dev/chainguard/minio-client@sha256:59f1924e417b6fcfdc0aca321e3bdebe8a56fd0efa7da80037d5eb65a203d687 AS mc
FROM mongo:8.3@sha256:747773029b84309981a3624a1af64ffc8c4d792283cc0834f26fe01fc6d28b34
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
# curl sends the alert mail (backup-alert) over STARTTLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY backup-run backup-loop backup-prune backup-alert backup-lib /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup-run /usr/local/bin/backup-loop /usr/local/bin/backup-prune /usr/local/bin/backup-alert /usr/local/bin/backup-lib
ENV MC_CONFIG_DIR=/tmp/mc
ENTRYPOINT []
CMD ["backup-loop"]
