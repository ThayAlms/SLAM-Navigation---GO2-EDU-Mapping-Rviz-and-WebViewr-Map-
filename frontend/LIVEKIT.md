# LiveKit no frontend da Vercel

Esta primeira etapa prepara o navegador para receber a câmera do Go2 por
WebRTC. Ela inclui:

- uma Vercel Function protegida pela sessão do Supabase;
- tokens LiveKit de 10 minutos com permissão somente de assistir;
- conexão do React à sala `go2-primary`;
- exibição automática da primeira faixa de vídeo remota;
- câmera JPEG atual preservada enquanto `VITE_LIVEKIT_ENABLED=false`.

## 1. Criar o projeto no LiveKit Cloud

Crie um projeto no LiveKit Cloud e copie estes três valores em **Project
Settings**:

- Project URL, no formato `wss://...livekit.cloud`;
- API Key;
- API Secret.

Não coloque a API Secret em variável `VITE_*`.

## 2. Configurar a Vercel

O **Root Directory** do projeto Vercel deve continuar sendo `frontend`.

Em **Project Settings > Environment Variables**, configure em Production e
Preview:

```dotenv
LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud
LIVEKIT_API_KEY=SUA_API_KEY
LIVEKIT_API_SECRET=SEU_API_SECRET
LIVEKIT_ROOM_NAME=go2-primary

SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_LIVEKIT_ENABLED=true
VITE_LIVEKIT_TOKEN_ENDPOINT=/api/livekit-token
```

`LIVEKIT_API_SECRET` fica disponível somente para `api/livekit-token.js`. As
variáveis `VITE_*` são públicas e entram no JavaScript do navegador.

Depois de salvar as variáveis, faça um novo deployment. Mudanças de ambiente
não alteram deployments já publicados.

## 3. Testar a primeira etapa

1. Entre normalmente no painel publicado na Vercel.
2. Abra o painel do Go2.
3. Na área da câmera, confirme a mensagem **Conectado ao LiveKit**.

Enquanto não existir um publicador na Jetson, a mensagem
**Aguardando a Jetson publicar a câmera na sala go2-primary** é o comportamento
esperado.

Para testar a Function diretamente, use uma sessão real do Supabase:

```bash
curl -i -X POST https://SEU-DOMINIO.vercel.app/api/livekit-token \
  -H "Authorization: Bearer JWT_DO_USUARIO" \
  -H "Content-Type: application/json" \
  -d '{"room_name":"go2-primary"}'
```

O retorno esperado é HTTP `201` com `server_url` e `participant_token`.

## 4. Publicar câmera e nuvem de pontos da Jetson

O transporte remoto usa dois caminhos na mesma sala:

- câmera RTP/H.264 do Go2 → GStreamer → LiveKit Ingress RTMP;
- mapa do gateway local → Function protegida da Vercel → pacote binário
  `go2.pointcloud` do LiveKit.

Gere uma chave exclusiva para a ponte da Jetson:

```bash
openssl rand -hex 32
```

`ROBOT_PUBLISHER_KEY` e a Function da Vercel permanecem disponíveis como
fallback, mas a Jetson usa por padrão a CLI `lk` já autenticada para enviar a
nuvem diretamente à sala. Assim, a proteção do deployment da Vercel não
interfere nos dados do LiDAR.

Crie o Ingress da câmera com a CLI já autenticada:

```bash
lk ingress create robot_gateway/livekit_ingress.json
```

Guarde a URL RTMP e a Stream Key retornadas pelo LiveKit. Na Jetson, inicie
primeiro o gateway ROS/SLAM:

```bash
./robot_gateway/run_gateway.sh
```

Em outro terminal, configure apenas a sessão atual e inicie os dois fluxos:

```bash
export LIVEKIT_INGRESS_URL='rtmps://URL-DO-INGRESS'
export LIVEKIT_STREAM_KEY='STREAM-KEY-DO-INGRESS'
./robot_gateway/run_livekit_streams.sh
```

O script usa FFmpeg para a saída RTMPS e envia 800 pontos por segundo com
`lk room send-data`. A nuvem usa quantização binária e Base64 para ficar abaixo
do limite de pacote do LiveKit. Os segredos existem somente no ambiente da
Jetson e nunca devem ser adicionados ao Git.
