import { useEffect, useRef, useState } from "react";

function quaternionYaw(pose) {
  if (!pose) return 0;
  const siny = 2 * (pose.qw * pose.qz + pose.qx * pose.qy);
  const cosy = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz);
  return Math.atan2(siny, cosy);
}

function PointCloudMap({ points, pose }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [yaw, setYaw] = useState(-0.65);
  const [pitch, setPitch] = useState(-0.55);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d", { alpha: true });

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!points || points.length < 3) return;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let index = 0; index < points.length; index += 3) {
        minX = Math.min(minX, points[index]);
        maxX = Math.max(maxX, points[index]);
        minY = Math.min(minY, points[index + 1]);
        maxY = Math.max(maxY, points[index + 1]);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const extent = Math.max(maxX - minX, maxY - minY, 2);
      const scale = (Math.min(rect.width, rect.height) * 0.78 * zoom) / extent;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      function project(worldX, worldY, worldZ) {
        const x = worldX - centerX;
        const y = worldY - centerY;
        const rotatedX = x * cosY - y * sinY;
        const rotatedY = x * sinY + y * cosY;
        const projectedY = rotatedY * cosP - worldZ * sinP;
        return {
          x: rect.width / 2 + rotatedX * scale,
          y: rect.height / 2 - projectedY * scale,
          depth: rotatedY * sinP + worldZ * cosP,
          z: worldZ,
        };
      }

      const projected = [];
      for (let index = 0; index < points.length; index += 3) {
        projected.push(project(points[index], points[index + 1], points[index + 2]));
      }
      projected.sort((first, second) => first.depth - second.depth);

      for (const point of projected) {
        const height = Math.max(0, Math.min(1, (point.z + 0.4) / 2.4));
        const red = Math.round(42 + height * 160);
        const green = Math.round(169 + height * 55);
        const blue = Math.round(224 - height * 120);
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, .84)`;
        context.fillRect(point.x, point.y, 1.8, 1.8);
      }

      if (pose) {
        const robot = project(pose.x, pose.y, pose.z);
        const heading = quaternionYaw(pose);
        const direction = project(
          pose.x + Math.cos(heading) * 0.35,
          pose.y + Math.sin(heading) * 0.35,
          pose.z,
        );
        context.strokeStyle = "#eaff4f";
        context.fillStyle = "#eaff4f";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(robot.x, robot.y);
        context.lineTo(direction.x, direction.y);
        context.stroke();
        context.beginPath();
        context.arc(robot.x, robot.y, 5, 0, Math.PI * 2);
        context.fill();
        context.font = "700 9px Inter, sans-serif";
        context.fillText("GO2", robot.x + 8, robot.y - 7);
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [pitch, points, pose, yaw, zoom]);

  function handlePointerDown(event) {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) return;
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    setYaw((current) => current + deltaX * 0.008);
    setPitch((current) => Math.max(-1.35, Math.min(0.1, current + deltaY * 0.006)));
    dragRef.current = { x: event.clientX, y: event.clientY };
  }

  function stopDragging() {
    dragRef.current = null;
  }

  function handleWheel(event) {
    event.preventDefault();
    setZoom((current) =>
      Math.max(0.35, Math.min(4, current * Math.exp(-event.deltaY * 0.001))),
    );
  }

  return (
    <div
      className="point-cloud-view"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} aria-label="Nuvem de pontos 3D do Go2" />
      {(!points || points.length === 0) && (
        <div className="stream-empty map-empty-state">
          <span className="stream-empty-icon">⌁</span>
          <strong>Aguardando pontos do LiDAR</strong>
          <small>O mapa aparecerá quando o LIO publicar uma nuvem estável.</small>
        </div>
      )}
      <span className="map-interaction-hint">Arraste para girar · scroll para zoom</span>
    </div>
  );
}

export default PointCloudMap;
