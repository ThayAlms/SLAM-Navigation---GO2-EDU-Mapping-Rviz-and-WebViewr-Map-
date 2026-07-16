# Frontend XD4 Robotics + Go2

Aplicação React/Vite importada do `ProjetoOracleFrontBanco` e conectada ao
FastAPI deste repositório. Ela contém login Supabase, gestão de usuários restrita
a administradores, rota protegida, câmera do Go2, nuvem 3D, localização, mapa e
teleoperação.

## Configuração

```bash
cp .env.example .env.local
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. O script raiz
`run_web.sh` define `VITE_API_URL` automaticamente com o IP da Jetson durante o
build Docker.

Nenhuma secret/service-role pode ser adicionada neste diretório.

O login não oferece cadastro público. Usuários com `profiles.role = 'admin'`
veem a opção **Usuários** no cabeçalho e podem criar acessos comuns ou
administrativos por meio do backend.

## LiveKit na Vercel

A base do receptor WebRTC e da Vercel Function que emite tokens está descrita
em [`LIVEKIT.md`](LIVEKIT.md). O recurso permanece desativado por padrão para
preservar a câmera atual até a Jetson começar a publicar na sala LiveKit.

## Desenvolvimento isolado

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

Para iniciar o sistema completo, use `./run_web.sh` na raiz do repositório.
