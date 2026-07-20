import { useEffect, useRef, useState } from "react";

import {
  gamepadDisplayName,
  hasGamepadMotion,
  isGamepadButtonPressed,
  readGamepadMotion,
} from "./gamepad";

const INITIAL_STATE = {
  supported: true,
  secureContext: true,
  connected: false,
  name: "",
  standardMapping: false,
};

function initialState() {
  return {
    ...INITIAL_STATE,
    supported: typeof navigator.getGamepads === "function",
    secureContext: window.isSecureContext,
  };
}

function sameState(first, second) {
  return Object.keys(INITIAL_STATE).every((key) => first[key] === second[key]);
}

export function useGamepadControl({ canMove, onMotion, onStop, onAction }) {
  const [state, setState] = useState(initialState);
  const callbacksRef = useRef({ canMove, onMotion, onStop, onAction });

  useEffect(() => {
    callbacksRef.current = { canMove, onMotion, onStop, onAction };
  }, [canMove, onAction, onMotion, onStop]);

  useEffect(() => {
    const supported = typeof navigator.getGamepads === "function";
    const secureContext = window.isSecureContext;
    if (!supported || !secureContext) return undefined;

    let animationFrame = null;
    let activeIndex = null;
    let isMoving = false;
    let previousButtons = [];
    let avoidanceOffStartedAt = null;
    let avoidanceOffSent = false;
    let pageActive = !document.hidden && document.hasFocus();
    let movementSuppressed = false;

    function publishState(gamepad) {
      const nextState = gamepad
        ? {
            supported: true,
            secureContext: true,
            connected: true,
            name: gamepadDisplayName(gamepad.id),
            standardMapping: gamepad.mapping === "standard",
          }
        : INITIAL_STATE;
      setState((current) => sameState(current, nextState) ? current : nextState);
    }

    function stopGamepadMotion() {
      if (!isMoving) return;
      isMoving = false;
      callbacksRef.current.onStop();
    }

    function rising(buttons, index) {
      return isGamepadButtonPressed(buttons, index) && !previousButtons[index];
    }

    function readButtons(gamepad, now) {
      const buttons = gamepad.buttons || [];
      const l2 = isGamepadButtonPressed(buttons, 6);
      let actionTriggered = false;

      function emitAction(action) {
        actionTriggered = true;
        callbacksRef.current.onAction(action);
      }

      // Layout padrão dos navegadores: A/Cross=0, B/Circle=1,
      // X/Square=2, Y/Triangle=3, L2=6 e START/Options=9.
      if (rising(buttons, 9) && !l2) {
        emitAction("arm");
      }
      if (rising(buttons, 1) && l2) {
        emitAction("damping");
      } else if (rising(buttons, 2) && l2) {
        emitAction("stand_up");
      } else if (rising(buttons, 0) && l2) {
        emitAction("toggle_posture");
      } else if (rising(buttons, 2) && !l2) {
        emitAction("avoidance_on");
      }

      const avoidanceOffPressed = isGamepadButtonPressed(buttons, 3) && !l2;
      if (avoidanceOffPressed && !previousButtons[3]) {
        avoidanceOffStartedAt = now;
        avoidanceOffSent = false;
      } else if (
        avoidanceOffPressed &&
        !avoidanceOffSent &&
        avoidanceOffStartedAt !== null &&
        now - avoidanceOffStartedAt >= 3_000
      ) {
        avoidanceOffSent = true;
        emitAction("avoidance_off");
      } else if (!avoidanceOffPressed) {
        avoidanceOffStartedAt = null;
        avoidanceOffSent = false;
      }

      previousButtons = Array.from(
        buttons,
        (button) => Boolean(button.pressed || button.value > 0.5),
      );
      return actionTriggered;
    }

    function gamepadAt(index) {
      try {
        return navigator.getGamepads()[index] || null;
      } catch {
        return null;
      }
    }

    function firstGamepad() {
      try {
        return Array.from(navigator.getGamepads()).find(Boolean) || null;
      } catch {
        return null;
      }
    }

    function tick(now) {
      let gamepad = activeIndex === null ? null : gamepadAt(activeIndex);
      if (!gamepad?.connected) gamepad = firstGamepad();

      if (!gamepad) {
        if (activeIndex !== null) {
          activeIndex = null;
          previousButtons = [];
          publishState(null);
          stopGamepadMotion();
        }
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      if (gamepad.index !== activeIndex) {
        activeIndex = gamepad.index;
        previousButtons = [];
        publishState(gamepad);
      }

      if (readButtons(gamepad, now)) {
        movementSuppressed = true;
        stopGamepadMotion();
      }
      const vector = readGamepadMotion(gamepad);
      const hasMotion = hasGamepadMotion(vector);
      if (!hasMotion) movementSuppressed = false;
      if (
        pageActive &&
        !movementSuppressed &&
        hasMotion &&
        callbacksRef.current.canMove
      ) {
        isMoving = true;
        callbacksRef.current.onMotion(vector);
      } else {
        stopGamepadMotion();
      }
      animationFrame = window.requestAnimationFrame(tick);
    }

    function handleConnected(event) {
      if (activeIndex === null) activeIndex = event.gamepad.index;
      publishState(event.gamepad);
    }

    function handleDisconnected(event) {
      if (event.gamepad.index !== activeIndex) return;
      activeIndex = null;
      previousButtons = [];
      publishState(null);
      stopGamepadMotion();
    }

    function handleBlur() {
      pageActive = false;
      stopGamepadMotion();
    }

    function handleFocus() {
      pageActive = !document.hidden;
    }

    function handleVisibility() {
      pageActive = !document.hidden && document.hasFocus();
      if (!pageActive) stopGamepadMotion();
    }

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.cancelAnimationFrame(animationFrame);
      stopGamepadMotion();
    };
  }, []);

  return state;
}
