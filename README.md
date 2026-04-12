# Zapatería App

Proyecto full stack con **frontend React**, **backend FastAPI** y **base de datos PostgreSQL**.

## Estructura

- `frontend/`: interfaz web
- `backend/`: API y lógica de negocio

## Funcionalidades incluidas

- Login con roles: `Ivan`, `Claudia`, `Tienda`
- Resumen diario con restricciones de domingo y sábado tarde
- Resumen mensual con categorías de gasto
- Estadísticas básicas
- Persistencia compartida en PostgreSQL

## Usuarios iniciales

- `Ivan` / contraseña definida por `INIT_ADMIN_PASSWORD`
- `Claudia` / contraseña definida por `INIT_ADMIN_PASSWORD`
- `Tienda` / contraseña definida por `INIT_STORE_PASSWORD`

## Backend local

1. Copia `backend/.env.example` a `backend/.env`
2. Crea la base de datos PostgreSQL
3. Instala dependencias:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

4. Arranca la API:

```bash
uvicorn app.main:app --reload
```

API local: `http://localhost:8000`

## Frontend local

1. Copia `frontend/.env.example` a `frontend/.env`
2. Instala dependencias:

```bash
cd frontend
npm install
npm run dev
```

Frontend local: `http://localhost:5173`

## Despliegue en Railway

### 1. Subir a GitHub

Desde la raíz del proyecto:

```bash
git init
git add .
git commit -m "Initial full stack version"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/zapateria-app.git
git push -u origin main
```

### 2. Crear PostgreSQL en Railway

- New Project
- Provision PostgreSQL
- Guarda las variables de conexión

### 3. Backend en Railway

Crea un servicio apuntando a la carpeta `backend`.

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
./start.sh
```

Variables necesarias:

- `SECRET_KEY`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `BACKEND_CORS_ORIGINS`
- `POSTGRES_SERVER`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `INIT_ADMIN_PASSWORD`
- `INIT_STORE_PASSWORD`

### 4. Frontend en Railway

Crea otro servicio apuntando a la carpeta `frontend`.

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm run preview
```

Variable necesaria:

- `VITE_API_BASE_URL=https://TU_BACKEND.up.railway.app`

## Notas

- La base de datos se crea automáticamente al arrancar el backend.
- Los usuarios semilla también se crean automáticamente si no existen.
- Para producción, cambia las contraseñas iniciales y usa un `SECRET_KEY` fuerte.
