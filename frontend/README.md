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

## Controle USB (PS4, PS5 e Xbox)

O painel usa a Gamepad API nativa do navegador. Como essa API só é liberada
em contexto seguro, no notebook abra um túnel SSH para a Jetson:

```bash
ssh -N -L 5173:127.0.0.1:5173 unitree@IP_DA_JETSON
```

Em seguida, abra `http://localhost:5173`, conecte o controle por cabo e
pressione qualquer botão. Chrome, Edge e Firefox atuais usam o mapeamento
padronizado para controles PS4/PS5/Xbox.

- Manche esquerdo: frente/ré e deslocamento lateral.
- Manche direito horizontal: giro.
- `START`/`Options`: habilita o canal de controle.
- `L2 + B`/Círculo: damping de emergência.
- `L2 + X`/Quadrado: levantar.
- `L2 + A`/Cruz: alternar entre levantar e deitar.
- `X`/Quadrado: ligar anticolisão.
- `Y`/Triângulo por 3 segundos: desligar anticolisão.

Ao soltar os manches, desconectar o cabo, trocar de aba ou perder o foco, o
painel envia parada ao robô. A velocidade continua limitada pelo percentual
selecionado no painel; 100% solicita o máximo publicado do Go2 EDU, de
aproximadamente 5 m/s em condições de laboratório. O firmware pode aplicar
limites adicionais conforme o modo de movimento e o ambiente.
