import { useEffect, useRef } from "react";

function SlamBackground({ className = "", variant = "default" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frameId;
    let width = 0;
    let height = 0;
    let particles = [];

    function buildParticles() {
      const count = variant === "login"
        ? Math.min(7200, Math.max(4200, Math.floor((width * height) / 300)))
        : Math.min(2600, Math.max(1100, Math.floor((width * height) / 760)));
      particles = Array.from({ length: count }, (_, index) => {
        if (variant === "login") {
          const surface = index % 4;
          const horizontal = Math.random();
          const depth = Math.random();
          let x;
          let y;
          if (surface === 0) {
            x = width * (0.04 + horizontal * 0.92);
            y = height * (0.56 + depth * 0.32 + Math.sin(horizontal * Math.PI * 4) * 0.018);
          } else if (surface === 1) {
            x = width * (0.08 + horizontal * 0.34);
            y = height * (0.2 + depth * 0.56 + horizontal * 0.08);
          } else if (surface === 2) {
            x = width * (0.58 + horizontal * 0.34);
            y = height * (0.2 + depth * 0.56 + (1 - horizontal) * 0.08);
          } else {
            x = width * (0.22 + horizontal * 0.56);
            y = height * (0.34 + Math.sin(horizontal * Math.PI * 3) * 0.08 + depth * 0.16);
          }
          return {
            x,
            y,
            z: depth,
            phase: Math.random() * Math.PI * 2,
            drift: 0,
            tone: index % 2 === 0 ? "red" : "blue",
          };
        }
        const band = index % 5;
        const baseX = Math.random() * width;
        const ridge = height * (0.56 + Math.sin(baseX * 0.011) * 0.08);
        return {
          x: baseX,
          y: ridge + (Math.random() - 0.5) * height * (band === 0 ? 0.48 : 0.3),
          z: Math.random(),
          phase: Math.random() * Math.PI * 2,
          drift: 0.12 + Math.random() * 0.35,
          tone: index % 2 === 0 ? "red" : "blue",
        };
      });
    }

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildParticles();
    }

    function drawGrid(time) {
      if (variant === "login") return;
      context.save();
      context.translate(width / 2, height * 0.71);
      context.strokeStyle = "rgba(42, 169, 224, 0.07)";
      context.lineWidth = 1;
      for (let row = 0; row < 9; row += 1) {
        const y = row * row * 5.5;
        context.beginPath();
        context.moveTo(-width, y);
        context.lineTo(width, y);
        context.stroke();
      }
      for (let column = -12; column <= 12; column += 1) {
        context.beginPath();
        context.moveTo(column * 34, 0);
        context.lineTo(column * 120, height * 0.55);
        context.stroke();
      }
      context.restore();

      const scannerY = height * (0.47 + Math.sin(time * 0.00035) * 0.07);
      const gradient = context.createLinearGradient(0, scannerY - 18, 0, scannerY + 18);
      gradient.addColorStop(0, "rgba(255, 28, 38, 0)");
      gradient.addColorStop(0.5, "rgba(255, 28, 38, 0.16)");
      gradient.addColorStop(1, "rgba(255, 28, 38, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, scannerY - 18, width, 36);
    }

    function render(time) {
      context.clearRect(0, 0, width, height);
      drawGrid(time);
      particles.forEach((particle) => {
        particle.x += particle.drift;
        if (particle.x > width + 5) particle.x = -5;
        const waveScale = variant === "login" ? 2.2 + particle.z * 1.8 : 2 + particle.z * 5;
        const wave = Math.sin(time * 0.0007 + particle.phase) * waveScale;
        const pulse = 0.42 + Math.sin(time * 0.0012 + particle.phase) * 0.2;
        const alpha = variant === "login"
          ? Math.min(0.9, pulse + 0.28)
          : Math.min(0.92, pulse + 0.24);
        if (particle.tone === "red") {
          context.fillStyle = `rgba(218, 35, 49, ${alpha})`;
        } else {
          context.fillStyle = `rgba(42, 169, 224, ${alpha})`;
        }
        const size = variant === "login"
          ? 0.9 + particle.z * 1.55
          : 1.15 + particle.z * 1.85;
        let drawX;
        let drawY;
        if (variant === "login") {
          const angle = Math.sin(time * 0.0002) * 0.11;
          const centerX = width / 2;
          const centerY = height * 0.56;
          const offsetX = particle.x - centerX;
          const offsetY = particle.y - centerY;
          drawX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
            + Math.sin(time * 0.00055 + particle.phase) * (2 + particle.z * 5);
          drawY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle) + wave;
        } else {
          const angle = Math.sin(time * 0.00013) * 0.075;
          const centerX = width / 2;
          const centerY = height * 0.58;
          const offsetX = particle.x - centerX;
          const offsetY = particle.y - centerY;
          drawX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
            + Math.sin(time * 0.00042 + particle.phase) * (3 + particle.z * 8);
          drawY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle) + wave;
        }
        context.fillRect(drawX, drawY, size, size);
      });
      frameId = window.requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  return <canvas className={`slam-background ${className}`.trim()} ref={canvasRef} aria-hidden="true" />;
}

export default SlamBackground;
