#!/usr/bin/env bash
# EN EL VPS: bash /tmp/casa/crm/tickets-mejoras/diagnostico-asignacion.sh   (solo lectura)
cd /home/ubuntu/isp-crm/backend
echo "== tecnicos.routes.ts (líneas 10-26) =="; sed -n 10,26p src/routes/tecnicos.routes.ts
echo; echo "== cómo se conectan las bases =="; grep -rn "controlPrisma\s*=\|new PrismaClient\|DATABASE_URL\|CONTROL_DATABASE" src --include=*.ts | head -15
echo; echo "== .env (solo nombres, sin claves) =="; grep -o '^[A-Z_]*DATABASE[A-Z_]*' .env
echo; echo "== asignación en tickets.routes.ts =="; grep -n "asignar" -A12 src/routes/tickets.routes.ts | head -30
