import { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'

const MIN_MS = 4000
const START = performance.now()

// Simplified from Phizzy's SimpleMichigan.svg (CC BY-SA 3.0):
// https://commons.wikimedia.org/wiki/File:SimpleMichigan.svg
// The two major land polygons retain the real Great Lakes coastlines while
// dropping sub-pixel islands and inlets that disappear at HUD size.
export const MITTEN_PATH =
  'M221.4 598 236.2 585.2 260.2 534.8 262.5 485.9 255.4 464.3 261.8 460.8 ' +
  '255 463.4 242.6 429.4 249.8 410.3 250.2 399.2 244.1 387.7 260.6 361.8 ' +
  '261.6 330.2 272.6 325.4 273.4 311 279.7 310.9 282.2 305.1 291 306.5 ' +
  '307.3 282.9 300.7 316.7 304.3 323.5 312.1 303.2 305.6 323.7 310.2 323.3 ' +
  '317.4 308 318.4 277.7 329.5 269.1 347.8 266 334.9 253.6 345.9 237.2 ' +
  '341.4 232.9 359.3 230.3 376.6 242.4 392.3 243.5 399.7 255.7 439.2 267.8 ' +
  '454.7 297.7 446.4 293.4 441.9 301.1 451.6 311.2 455 326.6 451.5 361.6 ' +
  '444.7 368.6 439.3 367.9 436.5 387.3 430.1 388.4 429.9 393.1 418.6 393.3 ' +
  '413.1 417.5 430.9 429.7 453.2 402.1 448.2 399.4 457.2 393.4 479.3 384.3 ' +
  '491.6 391.5 500.2 410.5 515.5 480.7 510.3 515.2 501.4 515.3 503.1 511.8 ' +
  '498.6 510 491.3 513.8 493.2 519.1 486.5 526.1 485.7 538.2 469 552.2 ' +
  '465.7 574.5 450.5 591.9 451.7 598.7 449.9 593.8 447.7 599.2 358.2 604.1 ' +
  '358 598.3 Z'

export const UP_PATH =
  'M0.3 152.1 25.9 143.4 39 132 64.8 129.7 82.9 117.1 92.9 116.5 ' +
  '113 97.1 114.1 105.2 121.7 108.4 125.9 118.7 121.9 139.6 128.6 130.2 ' +
  '144.3 121.4 134.6 134.2 147.6 125.7 164.9 128.7 178.6 139.1 193 164.7 ' +
  '215.1 162.1 223.6 170.9 231 167.2 238.5 172.7 249.1 160.7 269.7 149.8 ' +
  '308.8 149.7 325.9 142.2 344.5 140.8 340.1 146.4 339.3 166.3 352.8 170.5 ' +
  '365.1 166.7 368.4 173.1 385.7 166 394.1 188.5 388.1 192.4 403.7 198 ' +
  '401.1 201.5 412.3 211 405.7 214.8 375.8 209.8 372.1 213.4 363.8 205.9 ' +
  '358.9 215.8 361.2 224.7 357.8 225.5 341.6 210.2 310.4 202.2 300.3 214.2 ' +
  '285.8 214.1 284.1 218.4 274.9 214.4 261.2 216.1 255.8 229.7 241.4 237.1 ' +
  '239.2 247.3 232.3 240.4 238.3 231.1 242.9 231.6 244.3 221.5 237.2 225.8 ' +
  '228.6 223.5 224.8 236 216.8 240.7 216.4 218.3 210.4 237.3 201.9 243.4 ' +
  '175 291.8 166 282.7 171.8 267.4 156.9 268.1 163.9 255.6 164.4 238.8 ' +
  '158.8 232.1 142.8 226.6 145 217 118.6 206.7 109.1 209.2 82.8 195 ' +
  '18.2 174 12.8 158.6 Z'

const VB_LEFT = -5
const VB_TOP = 90
const VB_W = 530
const VB_H = 522
export const MICHIGAN_VIEWBOX = `${VB_LEFT} ${VB_TOP} ${VB_W} ${VB_H}`

export function MittenLoader() {
  const { active, progress } = useProgress()
  const [elapsed, setElapsed] = useState(0)
  const [hidden, setHidden] = useState(false)
  // __scenePainted flips in App's Scenes loop once a full frame has actually
  // hit the canvas — without it the fade lands on the shader-compile black gap
  const done = elapsed >= MIN_MS && !active && progress >= 100 && !!window.__scenePainted

  useEffect(() => {
    if (done) {
      // tell the camera the reveal is starting (Camera.jsx intro dolly)
      window.__mittenDone = true
      window.dispatchEvent(new Event('mitten-done'))
      const t = setTimeout(() => setHidden(true), 800)
      return () => clearTimeout(t)
    }
    const raf = requestAnimationFrame(() => setElapsed(performance.now() - START))
    return () => cancelAnimationFrame(raf)
  })

  if (hidden) return null

  // useProgress jumps in big steps (two assets) and can sit on one number for
  // seconds on a slow network — creep the cap asymptotically toward 99 so the
  // fill never looks stalled; 100 waits for real done (loaded + first paint)
  const ceil = progress >= 100 ? 100 : progress + (99 - progress) * (1 - Math.exp(-elapsed / 9000))
  const pct = done ? 100 : Math.min((elapsed / MIN_MS) * 100, ceil, 99)
  const fillTop = VB_TOP + (1 - pct / 100) * VB_H

  return (
    <div className={`mitten-loader${done ? ' done' : ''}`}>
      <svg viewBox={MICHIGAN_VIEWBOX} width="200" aria-hidden="true">
        <clipPath id="mitten-fill">
          <rect x={VB_LEFT} y={fillTop} width={VB_W} height={VB_H} />
        </clipPath>
        <path d={UP_PATH} fill="none" stroke="#e8f1e4" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={MITTEN_PATH} fill="none" stroke="#e8f1e4" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <g clipPath="url(#mitten-fill)">
          <path d={UP_PATH} fill="#7fa86b" />
          <path d={MITTEN_PATH} fill="#7fa86b" />
        </g>
      </svg>
      <div className="mitten-loader-label">PURE MICHIGAN</div>
      <div className="mitten-loader-pct">{Math.round(pct)}%</div>
    </div>
  )
}
