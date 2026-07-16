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

## 4. Próxima etapa: publicar a câmera da Jetson

O frontend apenas assina a faixa de vídeo. Ainda será necessário publicar o
H.264 recebido do Go2 na mesma sala usando LiveKit Ingress/WHIP ou um processo
publicador na Jetson. Essa etapa deve preservar o pipeline atual da câmera como
fallback até o WebRTC estar estável.
