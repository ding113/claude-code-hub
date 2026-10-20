import { createElement, type ComponentType, type ReactNode } from "react";
import { vi } from "vitest";

type MotionProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

const motionOnlyProps = new Set([
  "animate",
  "custom",
  "exit",
  "initial",
  "layout",
  "layoutId",
  "onAnimationComplete",
  "onAnimationStart",
  "transition",
  "variants",
  "whileFocus",
  "whileHover",
  "whileInView",
  "whileTap",
]);

function createMotionComponent(tag: string): ComponentType<MotionProps> {
  return ({ children, ...props }) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([name]) => !motionOnlyProps.has(name))
    );
    return createElement(tag, domProps, children);
  };
}

const motionComponents = new Map<string, ComponentType<MotionProps>>();
const motion = new Proxy({} as Record<string, ComponentType<MotionProps>>, {
  get: (_target, property: string | symbol) => {
    if (typeof property !== "string") return undefined;

    const existing = motionComponents.get(property);
    if (existing) return existing;

    const component = createMotionComponent(property);
    motionComponents.set(property, component);
    return component;
  },
});

vi.mock("framer-motion", () => ({ motion }));
