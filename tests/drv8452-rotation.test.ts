import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  convertCircuitJsonToPickAndPlaceRows,
  populatePartOrientationMetadata,
} from "../src"
import supplier from "./assets/drv8452-c5624514-supplier.circuit.json"
import routed from "./assets/drv8452-rotated-footprint.circuit.json"

// Real DRV8452DDWR/C5624514 pads: the board footprint was rotated +90°
// within the component. Its PCB placement remains 0°, with pin 1 bottom-left;
// the supplier's unrotated footprint has pin 1 at the upper left.
test("supplier export rejects the unverified DRV8452 placement by default", () => {
  expect(() =>
    convertCircuitJsonToPickAndPlaceRows(routed as AnyCircuitElement[], {
      supplier: "jlcpcb",
    }),
  ).toThrow("DRIVER: cannot verify jlcpcb")
})

test("qualified DRV8452 export rotates the supplier's numbered pads onto the board pads", async () => {
  const before = structuredClone(routed)
  const prepared = await populatePartOrientationMetadata(
    routed as AnyCircuitElement[],
    {
      supplier: "jlcpcb",
      partsEngine: {
        fetchPartCircuitJson: async ({ supplierPartNumber }) => {
          expect(supplierPartNumber).toBe("C5624514")
          return supplier as AnyCircuitElement[]
        },
      },
    },
  )
  const [row] = convertCircuitJsonToPickAndPlaceRows(prepared, {
    supplier: "jlcpcb",
  })
  expect(row).toMatchObject({
    designator: "DRIVER",
    mid_x: 8,
    mid_y: -9,
    layer: "top",
    rotation: 90,
  })
  expect(routed).toEqual(before)
  const radians = (row!.rotation * Math.PI) / 180
  for (const pad of supplier.filter((e) => e.type === "pcb_smtpad")) {
    const pin = pad.port_hints!.find((hint) => /^pin\d+$/.test(hint))!
    const target = routed.find(
      (e) => e.type === "pcb_smtpad" && e.port_hints?.includes(pin),
    )!
    const x =
      row!.mid_x + pad.x! * Math.cos(radians) - pad.y! * Math.sin(radians)
    const y =
      row!.mid_y + pad.x! * Math.sin(radians) + pad.y! * Math.cos(radians)
    expect(Math.abs(x - target.x!)).toBeLessThan(0.00001)
    expect(Math.abs(y - target.y!)).toBeLessThan(0.00001)
  }
})
