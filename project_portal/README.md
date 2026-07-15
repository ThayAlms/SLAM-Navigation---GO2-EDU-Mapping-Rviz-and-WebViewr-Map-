# Painel operacional do Go2

Interface local funcional com somente:

- câmera frontal ao vivo;
- mapa 3D LiDAR-inercial em tempo real e salvamento PCD;
- teclado e setas para teleoperação lenta;
- botões protegidos para levantar (`StandUp`) e deitar (`StandDown`).

Controles atuais:

- `W/S`: avançar a 0,22 m/s e recuar a 0,18 m/s;
- `A/D`: girar à esquerda e à direita a 0,30 rad/s;
- botões `−/+`: ajustar a velocidade de 10% a 50%, em passos de 5%;
- botões `LEVANTAR` e `DEITAR`: mudar a postura;
- espaço: parar.

O mapa mostra a posição atual `X/Y/Z` e o `yaw`, relativos ao ponto em que o
mapa foi iniciado. O marcador amarelo identifica o Go2 na nuvem.

## Executar

```bash
cd ~/Desktop/Teleop_Go2/project_portal
./run_dashboard.sh
```

Abra `http://127.0.0.1:8080`. O movimento começa bloqueado. Habilite o
controle na página somente com uma pessoa junto ao robô e a área livre.
O painel inicia em 30%. Ao mudar a velocidade, qualquer movimento ativo é
interrompido antes de o novo valor ser aplicado.

O painel usa a nuvem corrigida do LIO nativo `/utlidar/cloud_deskewed`, a
odometria `/utlidar/robot_odom` e a IMU `/utlidar/imu`. O mapa aceita apenas
quadros estáveis e guarda um único centróide por voxel de 6 cm, confirmado em
pelo menos dois quadros-chave.

Antes de mapear, levante o robô, espere alguns segundos, pressione **NOVO
MAPA** e só então percorra o ambiente lentamente.

Por segurança, o servidor escuta apenas a própria Jetson. A exposição por 4G
deverá ser feita posteriormente com autenticação e TLS.
