'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * AIscentra — vfinal Hero Globe (Frontend Design Foundation, layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own inline <script> globe
 * logic (lines ~740-858), preserving exact visual behavior: wireframe
 * sphere, lat/lon grid lines, 7 pulsing hub nodes at real-world
 * coordinates, randomly-connected great-circle arcs between them,
 * mouse-parallax rotation, auto-rotation, and viewport-based pause.
 *
 * Uses the real npm `three` package (0.185.1) rather than the HTML's
 * own r128 CDN script -- every THREE API this scene uses (Scene,
 * PerspectiveCamera, WebGLRenderer, Group, SphereGeometry,
 * WireframeGeometry, LineBasicMaterial, LineSegments, Vector3,
 * BufferGeometry, Line, MeshBasicMaterial, Mesh,
 * QuadraticBezierCurve3) is unchanged between r128 and current Three.js
 * -- confirmed by direct comparison against this exact set of calls,
 * not assumed.
 *
 * SSR-safe per task's own technical boundaries:
 * - 'use client' + all Three.js work inside useEffect (client-only,
 *   never touches window/document during SSR).
 * - Full cleanup on unmount: cancelAnimationFrame, removeEventListener
 *   (both mousemove and resize), IntersectionObserver.disconnect(),
 *   renderer.dispose(), and geometry/material .dispose() for every
 *   object this component itself creates -- prevents a second
 *   animation loop or leaked WebGL context after client-side
 *   navigation away from and back to a page using this component.
 * - IntersectionObserver pauses the render loop entirely outside the
 *   viewport (matches the HTML's own isGlobeVisible flag).
 * - prefers-reduced-motion: rendering happens once (a static frame) and
 *   the animation loop never starts -- not present in the original
 *   HTML, added per this task's own explicit technical-boundaries
 *   requirement ("учитывать prefers-reduced-motion").
 */
export function VfinalHeroGlobe(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000)
    camera.position.z = 15
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const disposables: Array<{ dispose: () => void }> = []

    const globeGroup = new THREE.Group()
    scene.add(globeGroup)

    const sphereGeo = new THREE.SphereGeometry(5, 24, 24)
    const wireframeGeo = new THREE.WireframeGeometry(sphereGeo)
    const wireframeMat = new THREE.LineBasicMaterial({
      color: 0xe5e7eb,
      transparent: true,
      opacity: 0.15,
    })
    globeGroup.add(new THREE.LineSegments(wireframeGeo, wireframeMat))
    disposables.push(sphereGeo, wireframeGeo, wireframeMat)

    const gridMat = new THREE.LineBasicMaterial({
      color: 0xe5e7eb,
      transparent: true,
      opacity: 0.1,
    })
    disposables.push(gridMat)

    for (let i = 0; i <= 6; i++) {
      const lat = (i / 6) * Math.PI - Math.PI / 2
      const radius = Math.cos(lat) * 5
      const yPos = Math.sin(lat) * 5
      const points: THREE.Vector3[] = []
      for (let j = 0; j <= 64; j++) {
        const theta = (j / 64) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(theta) * radius, yPos, Math.sin(theta) * radius))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      globeGroup.add(new THREE.Line(geo, gridMat))
      disposables.push(geo)
    }

    for (let i = 0; i < 12; i++) {
      const lon = (i / 12) * Math.PI * 2
      const points: THREE.Vector3[] = []
      for (let j = 0; j <= 32; j++) {
        const lat = (j / 32) * Math.PI - Math.PI / 2
        const radius = Math.cos(lat) * 5
        const yPos = Math.sin(lat) * 5
        points.push(new THREE.Vector3(Math.cos(lon) * radius, yPos, Math.sin(lon) * radius))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      globeGroup.add(new THREE.Line(geo, gridMat))
      disposables.push(geo)
    }

    function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
      const phi = (90 - lat) * (Math.PI / 180)
      const theta = (lon + 180) * (Math.PI / 180)
      return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      )
    }

    const hubs = [
      { lat: 37.77, lon: -122.41 },
      { lat: 40.71, lon: -74.0 },
      { lat: 51.5, lon: -0.12 },
      { lat: 48.85, lon: 2.35 },
      { lat: 35.68, lon: 139.69 },
      { lat: -33.86, lon: 151.2 },
      { lat: 1.35, lon: 103.81 },
    ]

    interface HubNode extends THREE.Mesh {
      userData: { glow?: THREE.Mesh }
    }
    const hubNodes: HubNode[] = []
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xa3f305 })
    const nodeGeo = new THREE.SphereGeometry(0.1, 8, 8)
    disposables.push(nodeMat, nodeGeo)

    hubs.forEach((hub) => {
      const pos = latLonToVec3(hub.lat, hub.lon, 5)
      const node = new THREE.Mesh(nodeGeo, nodeMat) as HubNode
      node.position.copy(pos)
      globeGroup.add(node)
      hubNodes.push(node)

      const glowGeo = new THREE.SphereGeometry(0.3, 8, 8)
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xa3f305,
        transparent: true,
        opacity: 0.3,
      })
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.copy(pos)
      globeGroup.add(glow)
      node.userData.glow = glow
      disposables.push(glowGeo, glowMat)
    })

    function createArc(start: THREE.Vector3, end: THREE.Vector3): THREE.Line {
      const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      midPoint.normalize().multiplyScalar(5 + start.distanceTo(end) * 0.4)
      const curve = new THREE.QuadraticBezierCurve3(start, midPoint, end)
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50))
      const mat = new THREE.LineBasicMaterial({ color: 0xa3f305, transparent: true, opacity: 0.4 })
      disposables.push(geo, mat)
      return new THREE.Line(geo, mat)
    }

    for (let i = 0; i < hubs.length; i++) {
      for (let j = i + 1; j < hubs.length; j++) {
        if (Math.random() > 0.5) {
          const hi = hubs[i]
          const hj = hubs[j]
          if (hi && hj) {
            globeGroup.add(
              createArc(latLonToVec3(hi.lat, hi.lon, 5), latLonToVec3(hj.lat, hj.lon, 5)),
            )
          }
        }
      }
    }

    let mouseX = 0
    let mouseY = 0
    let targetX = 0
    let targetY = 0
    const onMouseMove = (e: MouseEvent): void => {
      mouseX = e.clientX / window.innerWidth - 0.5
      mouseY = e.clientY / window.innerHeight - 0.5
    }
    document.addEventListener('mousemove', onMouseMove)

    let time = 0
    let isGlobeVisible = true
    let rafId = 0

    function animateGlobe(): void {
      rafId = requestAnimationFrame(animateGlobe)
      if (!isGlobeVisible) return
      time += 0.05
      targetX += (mouseX - targetX) * 0.05
      targetY += (mouseY - targetY) * 0.05
      globeGroup.rotation.y += 0.001
      globeGroup.rotation.x = targetY * 0.5
      hubNodes.forEach((node, i) => {
        const scale = 1 + Math.sin(time + i) * 0.5
        node.scale.setScalar(scale)
        if (node.userData.glow) {
          node.userData.glow.scale.setScalar(scale * 1.5)
          const mat = node.userData.glow.material as THREE.MeshBasicMaterial
          mat.opacity = 0.3 + Math.sin(time + i) * 0.2
        }
      })
      renderer.render(scene, camera)
    }

    if (prefersReducedMotion) {
      // Static single frame -- no requestAnimationFrame loop starts at
      // all, matching the task's own reduced-motion requirement (not
      // present in the original HTML).
      renderer.render(scene, camera)
    } else {
      animateGlobe()
    }

    const globeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isGlobeVisible = entry.isIntersecting
        })
      },
      { threshold: 0.1 },
    )
    globeObserver.observe(container)

    const onResize = (): void => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      if (nw === 0 || nh === 0) return
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      globeObserver.disconnect()
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return <div ref={containerRef} className="hero-globe-container" aria-hidden="true" />
}
