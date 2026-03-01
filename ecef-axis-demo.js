import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const R = 1;

const AXIS_DEFS = [
  { key: '+X', color: 0xff4d4d, dir: worldFromLatLonECEF(0, 0) },
  { key: '+Y', color: 0x3ecf6d, dir: worldFromLatLonECEF(0, 90) },
  { key: '+Z', color: 0x4fa3ff, dir: worldFromLatLonECEF(90, 0) },
];

const params = {
  backgroundColor: '#0b0f18',

  axisLength: 1.75,
  shaftRadius: 0.02,
  shaftSides: 18,
  coneLength: 0.22,
  coneRadius: 0.07,
  coneTipRatio: 0.0,
  coneSides: 24,
  hiddenOpacity: 0.2,

  equatorRadius: 1.001,
  equatorTubeRadius: 0.006,
  equatorOpacity: 0.5,
  showPrimeMeridian: true,
  primeMeridianLongitudeDeg: 0,
  primeMeridianRadius: 1.001,
  primeMeridianTubeRadius: 0.006,
  primeMeridianOpacity: 0.7,
  primeMeridianColor: '#ffd36b',

  showMarkers: true,
  markerRadius: 0.035,
  markerOffset: 1.002,

  showLabels: true,
  labelOffset: 0.18,
  labelScale: 0.34,

  cutawayEnabled: false,
  cutawayCapRadiusScale: 0.999,
  cutawayCapSegments: 72,
  cutawayCapOpacity: 1.0,
  cutawayShowCore: true,
  cutawayCoreRadius: 0.24,
  cutawayCoreOpacity: 1.0,
  cutawayCoreColor: '#f4c860',
  cutawayCoreEmissive: '#8a3f08',
  cutawayCoreEmissiveIntensity: 0.45,

  exportScale: 1,
  exportTransparentBg: false,
  exportFilenameBase: 'ecef-viewport',
  exportNow: () => {},
};

const ECEF_BASIS = {
  x: ecefToWorld(new THREE.Vector3(1, 0, 0)).normalize(),
  y: ecefToWorld(new THREE.Vector3(0, 1, 0)).normalize(),
  z: ecefToWorld(new THREE.Vector3(0, 0, 1)).normalize(),
};

function ecefFromLatLon(latDeg, lonDeg, radius = R) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);

  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat)
  );
}

// Three.js default earth texture orientation does not match ECEF world axes directly.
// Map ECEF basis into world so texture stays in its original orientation:
// X_ecef -> +X_world, Y_ecef -> -Z_world, Z_ecef -> +Y_world.
function ecefToWorld(vectorECEF) {
  return new THREE.Vector3(vectorECEF.x, vectorECEF.z, -vectorECEF.y);
}

function worldFromLatLonECEF(latDeg, lonDeg, radius = R) {
  return ecefToWorld(ecefFromLatLon(latDeg, lonDeg, radius));
}

function disposeMaterial(material) {
  if (!material) {
    return;
  }
  if (material.map && !material.userData.keepMapAlive) {
    material.map.dispose();
  }
  material.dispose();
}

function disposeObject3D(root) {
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        disposeMaterial(material);
      }
    } else {
      disposeMaterial(node.material);
    }
  });
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject3D(child);
  }
}

function makeAxisLabel(text, color, worldPosition, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 88px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 12;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);

  ctx.fillStyle = new THREE.Color(color).getStyle();
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(worldPosition);
  sprite.scale.set(scale, scale * 0.5, 1);
  sprite.renderOrder = 4;
  return sprite;
}

function makeMarker(position, color, radius) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.0 })
  );
  marker.position.copy(position);
  marker.renderOrder = 4;
  return marker;
}

function makeArrowForAxis(axisDef, p) {
  const group = new THREE.Group();
  const yAxis = new THREE.Vector3(0, 1, 0);

  const shaftSides = Math.max(6, Math.round(p.shaftSides));
  const coneSides = Math.max(6, Math.round(p.coneSides));
  const coneTip = THREE.MathUtils.clamp(p.coneTipRatio, 0, 1);

  const minBody = 0.02;
  const coneLength = THREE.MathUtils.clamp(p.coneLength, 0.02, p.axisLength - minBody);
  const shaftLength = Math.max(minBody, p.axisLength - coneLength);

  const shaftGeometry = new THREE.CylinderGeometry(1, 1, 1, shaftSides, 1, false);
  const coneGeometry = new THREE.CylinderGeometry(coneTip, 1, 1, coneSides, 1, false);

  const hiddenMaterial = new THREE.MeshStandardMaterial({
    color: axisDef.color,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: p.hiddenOpacity,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  });

  const visibleMaterial = new THREE.MeshStandardMaterial({
    color: axisDef.color,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.LessEqualDepth,
  });

  function buildLayer(material, renderOrder) {
    const layer = new THREE.Group();

    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.scale.set(p.shaftRadius, shaftLength, p.shaftRadius);
    shaft.position.set(0, shaftLength * 0.5, 0);
    shaft.renderOrder = renderOrder;
    layer.add(shaft);

    const cone = new THREE.Mesh(coneGeometry, material);
    cone.scale.set(p.coneRadius, coneLength, p.coneRadius);
    cone.position.set(0, shaftLength + coneLength * 0.5, 0);
    cone.renderOrder = renderOrder;
    layer.add(cone);

    return layer;
  }

  const hiddenLayer = buildLayer(hiddenMaterial, 2);
  const visibleLayer = buildLayer(visibleMaterial, 3);

  group.add(hiddenLayer, visibleLayer);
  group.quaternion.setFromUnitVectors(yAxis, axisDef.dir.clone().normalize());

  return group;
}

function makeEquatorRing(p) {
  const equator = new THREE.Mesh(
    new THREE.TorusGeometry(p.equatorRadius, p.equatorTubeRadius, 18, 180),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: p.equatorOpacity,
      roughness: 0.4,
      metalness: 0.0,
    })
  );
  // In this world mapping, ECEF +Z aligns with world +Y, so equator is XZ plane.
  equator.rotation.x = Math.PI * 0.5;
  return equator;
}

function makePrimeMeridianRing(p) {
  const primeMeridian = new THREE.Mesh(
    new THREE.TorusGeometry(p.primeMeridianRadius, p.primeMeridianTubeRadius, 18, 180),
    new THREE.MeshStandardMaterial({
      color: p.primeMeridianColor,
      transparent: true,
      opacity: p.primeMeridianOpacity,
      roughness: 0.4,
      metalness: 0.0,
    })
  );
  // Prime meridian (lon=0) is XY plane here; other longitudes rotate around world +Y.
  primeMeridian.rotation.y = THREE.MathUtils.degToRad(p.primeMeridianLongitudeDeg);
  return primeMeridian;
}

function makeCrossSectionTexture(maxAnisotropy = 1) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const cx = size * 0.5;
  const cy = size * 0.5;
  const radius = size * 0.5;

  const layers = [
    { ratio: 1.0, color: '#9b6a4f' },   // crust rim
    { ratio: 0.94, color: '#c6885e' },  // upper mantle
    { ratio: 0.78, color: '#de9f6f' },  // lower mantle
    { ratio: 0.52, color: '#d67745' },  // transition
    { ratio: 0.35, color: '#f1b652' },  // outer core
    { ratio: 0.19, color: '#f7dd84' },  // inner core
  ];

  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * layer.ratio, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(60, 25, 10, 0.18)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 28; i += 1) {
    const ringRadius = radius * (0.25 + (i / 28) * 0.72);
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function makeQuarterDiskSegment(radius, dirA, dirB, segments, material) {
  const segmentCount = Math.max(8, Math.round(segments));
  const normal = new THREE.Vector3().crossVectors(dirA, dirB).normalize();

  const positions = [0, 0, 0];
  const normals = [normal.x, normal.y, normal.z];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let i = 0; i <= segmentCount; i += 1) {
    const t = (i / segmentCount) * (Math.PI * 0.5);
    const c = Math.cos(t);
    const s = Math.sin(t);

    const px = (dirA.x * c + dirB.x * s) * radius;
    const py = (dirA.y * c + dirB.y * s) * radius;
    const pz = (dirA.z * c + dirB.z * s) * radius;

    positions.push(px, py, pz);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(0.5 + 0.5 * c, 0.5 + 0.5 * s);

    if (i > 0) {
      indices.push(0, i, i + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return new THREE.Mesh(geometry, material);
}

function makeOctantCutawayPlanes(frameRoot) {
  const worldQuat = frameRoot.getWorldQuaternion(new THREE.Quaternion());
  const axesWorld = [
    ECEF_BASIS.x.clone().applyQuaternion(worldQuat).normalize(),
    ECEF_BASIS.y.clone().applyQuaternion(worldQuat).normalize(),
    ECEF_BASIS.z.clone().applyQuaternion(worldQuat).normalize(),
  ];

  return axesWorld.map((axis) => new THREE.Plane(axis.clone().negate(), 0));
}

function timestampForFilename() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

export function initECEFDemo(container) {
  const mount = container ?? document.body;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(params.backgroundColor);

  const camera = new THREE.PerspectiveCamera(
    45,
    mount.clientWidth / mount.clientHeight,
    0.1,
    100
  );
  const previousStart = new THREE.Vector3(2.4, 1.6, 1.4);
  const startDistance = previousStart.length() * 1.75;
  const xz = (previousStart.x + previousStart.z) * 0.5;
  const startDirection = new THREE.Vector3(xz, previousStart.y, xz).normalize();
  camera.position.copy(startDirection.multiplyScalar(startDistance));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.localClippingEnabled = true;
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  // NASA Blue Marble source:
  // https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg
  const earthTexture = new THREE.TextureLoader().load('./blue-marble-nasa-5400x2700.jpg');
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  keyLight.position.set(3, 2, 2);
  scene.add(keyLight);

  const frameRoot = new THREE.Group();
  // ECEF +Z maps to world +Y in this scene mapping.
  frameRoot.rotation.y = -Math.PI * 0.5;
  scene.add(frameRoot);

  const earthMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: earthTexture,
    roughness: 0.85,
    metalness: 0.0,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), earthMaterial);
  earth.renderOrder = 1;
  frameRoot.add(earth);

  const dynamicRoot = new THREE.Group();
  frameRoot.add(dynamicRoot);

  const cutawayRoot = new THREE.Group();
  frameRoot.add(cutawayRoot);
  const crossSectionTexture = makeCrossSectionTexture(renderer.capabilities.getMaxAnisotropy());

  function rebuildDynamicContent() {
    clearGroup(dynamicRoot);

    const equator = makeEquatorRing(params);
    equator.renderOrder = 3;
    dynamicRoot.add(equator);

    if (params.showPrimeMeridian) {
      const primeMeridian = makePrimeMeridianRing(params);
      primeMeridian.renderOrder = 3;
      dynamicRoot.add(primeMeridian);
    }

    for (const axisDef of AXIS_DEFS) {
      const arrow = makeArrowForAxis(axisDef, params);
      dynamicRoot.add(arrow);

      if (params.showMarkers) {
        const markerPos = axisDef.dir.clone().setLength(R * params.markerOffset);
        dynamicRoot.add(makeMarker(markerPos, axisDef.color, params.markerRadius));
      }

      if (params.showLabels) {
        const labelPos = axisDef.dir.clone().setLength(params.axisLength + params.labelOffset);
        dynamicRoot.add(makeAxisLabel(axisDef.key, axisDef.color, labelPos, params.labelScale));
      }
    }
  }

  function rebuildCutawayContent() {
    clearGroup(cutawayRoot);

    earthMaterial.clippingPlanes = [];
    earthMaterial.clipIntersection = false;
    earthMaterial.needsUpdate = true;

    if (!params.cutawayEnabled) {
      return;
    }

    earthMaterial.clippingPlanes = makeOctantCutawayPlanes(frameRoot);
    earthMaterial.clipIntersection = true;
    earthMaterial.needsUpdate = true;

    const capRadius = R * params.cutawayCapRadiusScale;
    const capSegments = params.cutawayCapSegments;

    function createCapMaterial() {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: crossSectionTexture,
        transparent: true,
        opacity: params.cutawayCapOpacity,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      material.userData.keepMapAlive = true;
      return material;
    }

    // Cap for plane x=0, covering the removed (+y,+z) quarter.
    const capX = makeQuarterDiskSegment(
      capRadius,
      ECEF_BASIS.y,
      ECEF_BASIS.z,
      capSegments,
      createCapMaterial()
    );
    capX.renderOrder = 2;
    cutawayRoot.add(capX);

    // Cap for plane y=0, covering the removed (+x,+z) quarter.
    const capY = makeQuarterDiskSegment(
      capRadius,
      ECEF_BASIS.z,
      ECEF_BASIS.x,
      capSegments,
      createCapMaterial()
    );
    capY.renderOrder = 2;
    cutawayRoot.add(capY);

    // Cap for plane z=0, covering the removed (+x,+y) quarter.
    const capZ = makeQuarterDiskSegment(
      capRadius,
      ECEF_BASIS.x,
      ECEF_BASIS.y,
      capSegments,
      createCapMaterial()
    );
    capZ.renderOrder = 2;
    cutawayRoot.add(capZ);

    if (params.cutawayShowCore) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(params.cutawayCoreRadius, 48, 36),
        new THREE.MeshStandardMaterial({
          color: params.cutawayCoreColor,
          transparent: true,
          opacity: params.cutawayCoreOpacity,
          roughness: 0.45,
          metalness: 0.05,
          emissive: params.cutawayCoreEmissive,
          emissiveIntensity: params.cutawayCoreEmissiveIntensity,
        })
      );
      core.renderOrder = 2;
      cutawayRoot.add(core);
    }
  }

  function rebuildAll() {
    rebuildDynamicContent();
    rebuildCutawayContent();
  }

  function applyBackgroundColor() {
    scene.background = new THREE.Color(params.backgroundColor);
  }

  function captureViewportPNG(options = {}) {
    const scale = options.scale ?? params.exportScale;
    const transparent = options.transparent ?? params.exportTransparentBg;
    const targetWidth = Math.max(1, Math.round(mount.clientWidth * scale));
    const targetHeight = Math.max(1, Math.round(mount.clientHeight * scale));

    const previousBackground = scene.background;
    const previousTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;
    const previousClearColor = new THREE.Color();
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();

    const renderTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    renderer.xr.enabled = false;
    if (transparent) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    } else {
      applyBackgroundColor();
    }

    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, camera);

    const pixels = new Uint8Array(targetWidth * targetHeight * 4);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, targetWidth, targetHeight, pixels);

    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = previousXrEnabled;
    scene.background = previousBackground;
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderTarget.dispose();

    const rowBytes = targetWidth * 4;
    const flipped = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < targetHeight; y += 1) {
      const srcOffset = (targetHeight - 1 - y) * rowBytes;
      const dstOffset = y * rowBytes;
      flipped.set(pixels.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;
    const ctx = outputCanvas.getContext('2d');
    const imageData = new ImageData(flipped, targetWidth, targetHeight);
    ctx.putImageData(imageData, 0, 0);

    return outputCanvas.toDataURL('image/png');
  }

  function exportViewportPNG(options = {}) {
    const shouldDownload = options.download ?? true;
    const fileBase = options.fileBase ?? params.exportFilenameBase;
    const dataUrl = captureViewportPNG(options);

    if (shouldDownload) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${fileBase}-${timestampForFilename()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return dataUrl;
  }

  params.exportNow = () => {
    exportViewportPNG();
  };

  rebuildAll();

  const gui = new GUI({ title: 'ECEF Controls' });
  gui.addColor(params, 'backgroundColor').name('Background').onChange(applyBackgroundColor);

  const arrowsFolder = gui.addFolder('Arrows');
  arrowsFolder.add(params, 'axisLength', 0.5, 3.0, 0.01).name('Length').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'shaftRadius', 0.003, 0.08, 0.001).name('Thickness').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'shaftSides', 6, 64, 1).name('Shaft sides').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'coneLength', 0.02, 1.2, 0.01).name('Cone length').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'coneRadius', 0.01, 0.2, 0.001).name('Cone radius').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'coneTipRatio', 0.0, 1.0, 0.01).name('Cone tip ratio').onChange(rebuildDynamicContent);
  arrowsFolder.add(params, 'coneSides', 6, 64, 1).name('Cone sides').onChange(rebuildDynamicContent);

  const occlusionFolder = gui.addFolder('Occlusion');
  occlusionFolder.add(params, 'hiddenOpacity', 0.0, 1.0, 0.01).name('Hidden opacity').onChange(rebuildDynamicContent);

  const equatorFolder = gui.addFolder('Equator');
  equatorFolder.add(params, 'equatorRadius', 0.98, 1.05, 0.0005).name('Radius').onChange(rebuildDynamicContent);
  equatorFolder.add(params, 'equatorTubeRadius', 0.001, 0.04, 0.0005).name('Thickness').onChange(rebuildDynamicContent);
  equatorFolder.add(params, 'equatorOpacity', 0.0, 1.0, 0.01).name('Opacity').onChange(rebuildDynamicContent);

  const primeFolder = gui.addFolder('Prime Meridian');
  primeFolder.add(params, 'showPrimeMeridian').name('Show').onChange(rebuildDynamicContent);
  primeFolder.add(params, 'primeMeridianLongitudeDeg', -180, 180, 0.1).name('Longitude').onChange(rebuildDynamicContent);
  primeFolder.add(params, 'primeMeridianRadius', 0.98, 1.05, 0.0005).name('Radius').onChange(rebuildDynamicContent);
  primeFolder.add(params, 'primeMeridianTubeRadius', 0.001, 0.04, 0.0005).name('Thickness').onChange(rebuildDynamicContent);
  primeFolder.add(params, 'primeMeridianOpacity', 0.0, 1.0, 0.01).name('Opacity').onChange(rebuildDynamicContent);
  primeFolder.addColor(params, 'primeMeridianColor').name('Color').onChange(rebuildDynamicContent);

  const markersFolder = gui.addFolder('Markers');
  markersFolder.add(params, 'showMarkers').name('Show').onChange(rebuildDynamicContent);
  markersFolder.add(params, 'markerRadius', 0.005, 0.1, 0.001).name('Radius').onChange(rebuildDynamicContent);
  markersFolder.add(params, 'markerOffset', 0.98, 1.05, 0.0005).name('Offset').onChange(rebuildDynamicContent);

  const labelsFolder = gui.addFolder('Labels');
  labelsFolder.add(params, 'showLabels').name('Show').onChange(rebuildDynamicContent);
  labelsFolder.add(params, 'labelOffset', 0.02, 0.8, 0.01).name('Offset').onChange(rebuildDynamicContent);
  labelsFolder.add(params, 'labelScale', 0.08, 0.7, 0.01).name('Scale').onChange(rebuildDynamicContent);

  const cutawayFolder = gui.addFolder('Cutaway');
  cutawayFolder.add(params, 'cutawayEnabled').name('Enable').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCapRadiusScale', 0.97, 1.002, 0.0005).name('Cap radius').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCapSegments', 12, 160, 1).name('Cap detail').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCapOpacity', 0.1, 1.0, 0.01).name('Cap opacity').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayShowCore').name('Show core').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCoreRadius', 0.06, 0.45, 0.005).name('Core radius').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCoreOpacity', 0.1, 1.0, 0.01).name('Core opacity').onChange(rebuildCutawayContent);
  cutawayFolder.addColor(params, 'cutawayCoreColor').name('Core color').onChange(rebuildCutawayContent);
  cutawayFolder.addColor(params, 'cutawayCoreEmissive').name('Core glow').onChange(rebuildCutawayContent);
  cutawayFolder.add(params, 'cutawayCoreEmissiveIntensity', 0.0, 2.0, 0.01).name('Core glow int').onChange(rebuildCutawayContent);

  const exportFolder = gui.addFolder('Export');
  exportFolder.add(params, 'exportScale', 0.5, 6.0, 0.25).name('Resolution x');
  exportFolder.add(params, 'exportTransparentBg').name('Transparent bg');
  exportFolder.add(params, 'exportFilenameBase').name('Filename');
  exportFolder.add(params, 'exportNow').name('Export PNG');

  arrowsFolder.close();
  occlusionFolder.close();
  equatorFolder.close();
  primeFolder.close();
  markersFolder.close();
  labelsFolder.close();
  cutawayFolder.close();
  exportFolder.close();

  function onResize() {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  window.addEventListener('resize', onResize);

  let rafId = 0;
  function animate() {
    controls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }
  animate();

  return {
    scene,
    camera,
    renderer,
    controls,
    gui,
    params,
    rebuild: rebuildAll,
    captureViewportPNG,
    exportViewportPNG,
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      gui.destroy();
      controls.dispose();

      clearGroup(cutawayRoot);
      clearGroup(dynamicRoot);
      earthMaterial.clippingPlanes = [];
      earthMaterial.clipIntersection = false;
      disposeObject3D(earth);
      crossSectionTexture.dispose();

      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    },
  };
}

const autoMount = document.getElementById('ecef-demo');
if (autoMount) {
  window.__ecefDemo = initECEFDemo(autoMount);
}
