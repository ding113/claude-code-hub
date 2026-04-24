/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

const maplibreMocks = vi.hoisted(() => {
  class FakeGeoJSONSource {
    data: unknown;
    setData = vi.fn((next: unknown) => {
      this.data = next;
    });

    constructor(data: unknown) {
      this.data = data;
    }
  }

  class FakePopup {
    options: Record<string, unknown>;
    lngLat = { lng: 0, lat: 0 };
    isOpenFlag = false;
    maxWidth = "none";
    offset: unknown = 16;
    container: HTMLElement | null = null;
    events = new globalThis.Map<string, Set<() => void>>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.offset = options.offset ?? 16;
    }

    setMaxWidth(value: string) {
      this.maxWidth = value;
      return this;
    }

    setDOMContent(node: HTMLElement) {
      this.container = node;
      if (!node.isConnected) {
        document.body.appendChild(node);
      }
      return this;
    }

    setLngLat([lng, lat]: [number, number]) {
      this.lngLat = { lng, lat };
      return this;
    }

    getLngLat() {
      return this.lngLat;
    }

    setOffset(value: unknown) {
      this.offset = value;
      return this;
    }

    addTo() {
      this.isOpenFlag = true;
      return this;
    }

    remove() {
      this.isOpenFlag = false;
      this.events.get("close")?.forEach((handler) => handler());
      this.container?.remove();
      return this;
    }

    isOpen() {
      return this.isOpenFlag;
    }

    on(event: string, handler: () => void) {
      if (!this.events.has(event)) {
        this.events.set(event, new Set());
      }
      this.events.get(event)?.add(handler);
      return this;
    }

    off(event: string, handler: () => void) {
      this.events.get(event)?.delete(handler);
      return this;
    }
  }

  class FakeMarker {
    lngLat = { lng: 0, lat: 0 };
    draggable = false;
    popup: FakePopup | null = null;
    element = globalThis.document?.createElement("div") ?? ({} as HTMLElement);

    constructor(options: Record<string, unknown>) {
      this.draggable = Boolean(options.draggable);
    }

    setLngLat([lng, lat]: [number, number]) {
      this.lngLat = { lng, lat };
      return this;
    }

    getLngLat() {
      return this.lngLat;
    }

    addTo() {
      return this;
    }

    remove() {
      return this;
    }

    getElement() {
      return this.element;
    }

    setPopup(popup: FakePopup | null) {
      this.popup = popup;
      return this;
    }

    setDraggable(value: boolean) {
      this.draggable = value;
      return this;
    }

    isDraggable() {
      return this.draggable;
    }

    setOffset() {
      return this;
    }

    getOffset() {
      return { x: 0, y: 0 };
    }

    setRotation() {
      return this;
    }

    getRotation() {
      return 0;
    }

    setRotationAlignment() {
      return this;
    }

    getRotationAlignment() {
      return "auto";
    }

    setPitchAlignment() {
      return this;
    }

    getPitchAlignment() {
      return "auto";
    }
  }

  const maps: FakeMap[] = [];

  class FakeMap {
    container: HTMLElement;
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
    style: unknown;
    sources = new globalThis.Map<string, FakeGeoJSONSource>();
    layers = new globalThis.Map<string, Record<string, unknown>>();
    listeners = new globalThis.Map<string, Set<(...args: unknown[]) => void>>();
    canvas = { style: { cursor: "" } };
    removed = false;
    moving = false;
    zoomTo = vi.fn((nextZoom: number) => {
      this.zoom = nextZoom;
    });
    resetNorthPitch = vi.fn(() => {
      this.bearing = 0;
      this.pitch = 0;
    });
    flyTo = vi.fn((next: { center: [number, number]; zoom?: number }) => {
      this.center = next.center;
      this.zoom = next.zoom ?? this.zoom;
    });
    jumpTo = vi.fn(
      (
        next: Partial<{ center: [number, number]; zoom: number; bearing: number; pitch: number }>
      ) => {
        this.center = next.center ?? this.center;
        this.zoom = next.zoom ?? this.zoom;
        this.bearing = next.bearing ?? this.bearing;
        this.pitch = next.pitch ?? this.pitch;
      }
    );
    setProjection = vi.fn();
    setPaintProperty = vi.fn();
    resize = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.container = options.container as HTMLElement;
      this.center = (options.center as [number, number] | undefined) ?? [0, 0];
      this.zoom = (options.zoom as number | undefined) ?? 0;
      this.bearing = (options.bearing as number | undefined) ?? 0;
      this.pitch = (options.pitch as number | undefined) ?? 0;
      this.style = options.style;
      this.container.requestFullscreen = vi.fn(async () => undefined);
      maps.push(this);

      queueMicrotask(() => {
        this.emit("load");
        this.emit("styledata");
        this.emit("idle");
      });
    }

    on(
      event: string,
      layerOrHandler: string | ((...args: unknown[]) => void),
      handler?: (...args: unknown[]) => void
    ) {
      const key = typeof layerOrHandler === "string" ? `${event}:${layerOrHandler}` : event;
      const actualHandler = typeof layerOrHandler === "string" ? handler : layerOrHandler;
      if (!actualHandler) return this;
      if (!this.listeners.has(key)) {
        this.listeners.set(key, new Set());
      }
      this.listeners.get(key)?.add(actualHandler);
      return this;
    }

    off(
      event: string,
      layerOrHandler: string | ((...args: unknown[]) => void),
      handler?: (...args: unknown[]) => void
    ) {
      const key = typeof layerOrHandler === "string" ? `${event}:${layerOrHandler}` : event;
      const actualHandler = typeof layerOrHandler === "string" ? handler : layerOrHandler;
      if (actualHandler) {
        this.listeners.get(key)?.delete(actualHandler);
      }
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((handler) => handler(...args));
    }

    getCenter() {
      return { lng: this.center[0], lat: this.center[1] };
    }

    getZoom() {
      return this.zoom;
    }

    getBearing() {
      return this.bearing;
    }

    getPitch() {
      return this.pitch;
    }

    isMoving() {
      return this.moving;
    }

    setStyle(style: unknown) {
      this.style = style;
      queueMicrotask(() => {
        this.emit("styledata");
        this.emit("idle");
      });
      return this;
    }

    isStyleLoaded() {
      return true;
    }

    addSource(id: string, source: Record<string, unknown>) {
      this.sources.set(id, new FakeGeoJSONSource(source.data));
      return this;
    }

    getSource(id: string) {
      return this.sources.get(id) ?? undefined;
    }

    removeSource(id: string) {
      this.sources.delete(id);
      return this;
    }

    addLayer(layer: Record<string, unknown>) {
      this.layers.set(layer.id as string, layer);
      return this;
    }

    getLayer(id: string) {
      return this.layers.get(id) ?? undefined;
    }

    removeLayer(id: string) {
      this.layers.delete(id);
      return this;
    }

    getCanvas() {
      return this.canvas;
    }

    getContainer() {
      return this.container;
    }

    remove() {
      this.removed = true;
      return this;
    }
  }

  return {
    FakeGeoJSONSource,
    FakeMap,
    FakeMarker,
    FakePopup,
    maps,
  };
});

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => ({
  default: {
    Map: maplibreMocks.FakeMap,
    Marker: maplibreMocks.FakeMarker,
    Popup: maplibreMocks.FakePopup,
  },
}));

import { Map, MapClusterLayer, MapControls, MapPopup, MapRoute } from "@/components/ui/map";

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    rerender: (next: ReactNode) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Map UI", () => {
  beforeEach(() => {
    maplibreMocks.maps.length = 0;
    document.body.innerHTML = "";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
  });

  test("MapControls drives map actions and locate never gets stuck without geolocation", async () => {
    const labels = {
      zoomIn: "放大地图",
      zoomOut: "缩小地图",
      locate: "定位到我的位置",
      fullscreen: "切换全屏地图",
      compass: "重置朝向",
    };
    const geolocationDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "geolocation");
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });

    const { container, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [120, 30], zoom: 5 }}>
          <MapControls showZoom showCompass showLocate showFullscreen labels={labels} />
        </Map>
      </div>
    );

    await flushMicrotasks();

    const map = maplibreMocks.maps.at(-1);
    expect(map).toBeTruthy();

    const zoomInButton = container.querySelector(
      `[aria-label="${labels.zoomIn}"]`
    ) as HTMLButtonElement;
    const zoomOutButton = container.querySelector(
      `[aria-label="${labels.zoomOut}"]`
    ) as HTMLButtonElement;
    const locateButton = container.querySelector(
      `[aria-label="${labels.locate}"]`
    ) as HTMLButtonElement;
    const fullscreenButton = container.querySelector(
      `[aria-label="${labels.fullscreen}"]`
    ) as HTMLButtonElement;
    const compassButton = container.querySelector(
      `[aria-label="${labels.compass}"]`
    ) as HTMLButtonElement;

    click(zoomInButton);
    click(zoomOutButton);
    click(compassButton);
    click(fullscreenButton);
    click(locateButton);

    expect(map?.zoomTo).toHaveBeenCalledTimes(2);
    expect(map?.resetNorthPitch).toHaveBeenCalledTimes(1);
    expect(map?.container.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(locateButton.disabled).toBe(false);

    if (geolocationDescriptor) {
      Object.defineProperty(window.navigator, "geolocation", geolocationDescriptor);
    } else {
      Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: undefined,
      });
    }

    unmount();
  });

  test("MapPopup closes via the provided localized label", async () => {
    const { unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [10, 20], zoom: 4 }}>
          <MapPopup longitude={10} latitude={20} closeButton closeLabel="关闭地图弹窗">
            <div>popup body</div>
          </MapPopup>
        </Map>
      </div>
    );

    await flushMicrotasks();

    const button = document.querySelector('[aria-label="关闭地图弹窗"]') as HTMLButtonElement;
    const popup = document.body.textContent ?? "";
    expect(button).toBeTruthy();
    expect(popup).toContain("popup body");

    click(button);

    expect(document.body.textContent ?? "").not.toContain("popup body");
    expect(maplibreMocks.maps).toHaveLength(1);

    unmount();
  });

  test("controlled viewport updates jump the map without recreating it", async () => {
    const { rerender, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }} />
      </div>
    );

    await flushMicrotasks();
    const map = maplibreMocks.maps.at(-1);
    expect(maplibreMocks.maps.length).toBe(1);

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [30, 40], zoom: 7 }} />
      </div>
    );

    await flushMicrotasks();

    expect(maplibreMocks.maps.length).toBe(1);
    expect(map?.jumpTo).toHaveBeenCalledWith({
      center: [30, 40],
      zoom: 7,
      bearing: 0,
      pitch: 0,
    });

    unmount();
  });

  test("projection updates sync without recreating the map", async () => {
    const { rerender, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }} projection={{ type: "mercator" }} />
      </div>
    );

    await flushMicrotasks();
    const map = maplibreMocks.maps.at(-1);
    expect(maplibreMocks.maps.length).toBe(1);

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }} projection={{ type: "globe" }} />
      </div>
    );

    await flushMicrotasks();

    expect(maplibreMocks.maps.length).toBe(1);
    expect(map?.setProjection).toHaveBeenLastCalledWith({ type: "globe" });

    unmount();
  });

  test("MapRoute clears rendered geometry when coordinates shrink below two points", async () => {
    const { rerender, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapRoute
            coordinates={[
              [1, 2],
              [3, 4],
            ]}
          />
        </Map>
      </div>
    );

    await flushMicrotasks();

    const map = maplibreMocks.maps.at(-1);
    const source = Array.from(map?.sources.values() ?? [])[0];
    expect(source?.setData).toHaveBeenLastCalledWith({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    });

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapRoute coordinates={[[1, 2]]} />
        </Map>
      </div>
    );

    await flushMicrotasks();

    expect(source?.setData).toHaveBeenLastCalledWith({
      type: "FeatureCollection",
      features: [],
    });

    unmount();
  });

  test("MapClusterLayer updates GeoJSON sources for string data changes", async () => {
    const { rerender, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapClusterLayer data="https://example.com/a.geojson" />
        </Map>
      </div>
    );

    await flushMicrotasks();

    const map = maplibreMocks.maps.at(-1);
    const source = Array.from(map?.sources.values() ?? [])[0];
    expect(source?.data).toBe("https://example.com/a.geojson");

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapClusterLayer data="https://example.com/b.geojson" />
        </Map>
      </div>
    );

    await flushMicrotasks();

    expect(source?.setData).toHaveBeenLastCalledWith("https://example.com/b.geojson");

    unmount();
  });

  test("MapClusterLayer re-adds recreated sources with the latest data", async () => {
    const { rerender, unmount } = render(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapClusterLayer data="https://example.com/a.geojson" clusterRadius={50} />
        </Map>
      </div>
    );

    await flushMicrotasks();

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapClusterLayer data="https://example.com/b.geojson" clusterRadius={50} />
        </Map>
      </div>
    );
    await flushMicrotasks();

    rerender(
      <div className="h-60 w-60">
        <Map viewport={{ center: [1, 2], zoom: 3 }}>
          <MapClusterLayer data="https://example.com/b.geojson" clusterRadius={60} />
        </Map>
      </div>
    );
    await flushMicrotasks();

    const map = maplibreMocks.maps.at(-1);
    const source = Array.from(map?.sources.values() ?? [])[0];
    expect(source?.data).toBe("https://example.com/b.geojson");

    unmount();
  });
});
