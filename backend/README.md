# XD4 Robotics API

API FastAPI entre o painel React, o Supabase e o gateway ROS executado na Jetson.

## Desenvolvimento

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
uvicorn app.main:app --reload
```

A documentação interativa fica em `http://localhost:8000/docs` e o health check em `http://localhost:8000/health`.

## Variáveis de ambiente

- `CORS_ORIGINS`: origens do frontend separadas por vírgula.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: chave pública usada para validar usuários.
- `SUPABASE_SERVICE_ROLE_KEY`: chave secreta usada somente pelo backend.
- `INTEGRATION_API_KEY`: segredo compartilhado com o bridge ROS/Jetson.
- `ROBOT_GATEWAY_URL`: gateway local para execução direta; deixe vazio para usar a fila 4G.
- `ROBOT_GATEWAY_API_KEY`: segredo compartilhado apenas entre FastAPI e gateway local.
- `ROBOT_GATEWAY_TIMEOUT_SECONDS`: timeout das chamadas locais.
- `ORACLE_API_URL` e `ORACLE_API_KEY`: reserva para a integração direta futura.

Copie `.env.example` para `.env`. O arquivo real não deve ser enviado ao Git.

## Endpoints do painel

Essas rotas exigem `Authorization: Bearer <jwt-do-supabase>`:

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/api/auth/me` | Retorna o usuário autenticado |
| `POST` | `/api/auth/login-events` | Registra o acesso no histórico |
| `GET` | `/api/robot/status` | Retorna telemetria e URLs atuais |
| `GET` | `/api/robot/camera/frame` | Retorna o último JPEG da câmera |
| `GET` | `/api/robot/map/points` | Retorna a nuvem consolidada |
| `POST` | `/api/robot/commands` | Executa no gateway ou adiciona à fila |
| `POST` | `/api/oracle/analyses` | Adiciona uma captura à fila Oracle |

## Execução direta na Jetson

Quando `ROBOT_GATEWAY_URL=http://127.0.0.1:8081`, o FastAPI encaminha os
comandos autenticados ao gateway ROS. Câmera, mapa e status também são
protegidos pelo JWT do operador. O frontend nunca acessa a porta 8081.

Sem `ROBOT_GATEWAY_URL`, os mesmos endpoints usam `robot_status` e
`robot_commands` no Supabase. Esse é o transporte reservado para a operação 4G.

## Contrato com a integração da Jetson

O bridge do outro time deve enviar `X-Integration-Key` em todas estas rotas:

- `POST /api/integrations/telemetry`: publica conectividade, bateria e URLs de vídeo/mapa.
- `GET /api/integrations/commands`: consome comandos pendentes em ordem.
- `PATCH /api/integrations/commands/{id}`: marca comando como processando, concluído ou com falha.
- `GET /api/integrations/oracle-analyses`: consome capturas pendentes.
- `PATCH /api/integrations/oracle-analyses/{id}`: publica o resultado da análise.

Exemplo de telemetria:

```json
{
  "robot_id": "primary",
  "robot_online": true,
  "network_online": true,
  "sdk_connected": true,
  "battery_percent": 74,
  "video_stream_url": "https://stream.exemplo/video",
  "map_data_url": "https://mapa.exemplo/robot",
  "telemetry": {}
}
```

Resultados de comandos e análises usam o mesmo formato:

```json
{
  "status": "completed",
  "error_message": null,
  "result": {}
}
```

Os status aceitos no retorno são `processing`, `completed` e `failed`. Os
comandos do painel são `forward`, `backward`, `rotate_left`, `rotate_right`,
`stand_up`, `stand_down`, `arm`, `disarm`, `set_speed`, `reset_map`, `save_map`,
`stop` e `emergency_stop`.

## Testes

```bash
pytest
```
