import { expect, spyOn, test } from "bun:test"
import type { AnyCircuitElement, PcbComponent } from "circuit-json"
import {
  convertCircuitJsonToPickAndPlaceCsv,
  convertCircuitJsonToPickAndPlaceRows,
  type PickAndPlaceRotationWarning,
} from "../src"

const circuit = (
  overrides: Partial<PcbComponent> = {},
): AnyCircuitElement[] => [
  {
    type: "source_component",
    source_component_id: "source_led",
    ftype: "simple_chip",
    name: "D_RGB",
    supplier_part_numbers: { jlcpcb: ["C5378730"] },
  },
  {
    type: "pcb_component",
    pcb_component_id: "pcb_led",
    source_component_id: "source_led",
    center: { x: 20, y: -19 },
    width: 4.2,
    height: 6.2,
    layer: "top",
    rotation: 180,
    obstructs_within_bounds: true,
    ...overrides,
  },
]

test("warns by default when supplier export falls back to an unverified PCB rotation", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  try {
    expect(
      convertCircuitJsonToPickAndPlaceCsv(circuit(), { supplier: "jlcpcb" }),
    ).toContain("D_RGB,20.000,-19.000,top,180")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain("D_RGB: cannot verify jlcpcb")
    expect(warn.mock.calls[0]![0]).toContain("missing_pin1_location")
  } finally {
    warn.mockRestore()
  }
})

for (const [overrides, reason] of [
  [{}, "missing_pin1_location"],
  [
    {
      pin1_location: "leftside_top",
      supplier_pin1_location_map: { pcbway: "leftside_top" },
    },
    "missing_supplier_pin1_location",
  ],
  [
    {
      pin1_location: "leftside_top",
      supplier_pin1_location_map: { jlcpcb: "leftside_bottom" },
    },
    "incompatible_pin1_locations",
  ],
] as const) {
  test(`reports ${reason} with component identity`, () => {
    const warnings: PickAndPlaceRotationWarning[] = []
    const rows = convertCircuitJsonToPickAndPlaceRows(circuit(overrides), {
      supplier: "jlcpcb",
      onRotationWarning: (warning) => warnings.push(warning),
    })
    expect(rows[0]!.rotation).toBe(180)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      designator: "D_RGB",
      pcb_component_id: "pcb_led",
      supplier: "jlcpcb",
      reason,
    })
  })
  test(`strict CSV export rejects ${reason}`, () => {
    expect(() =>
      convertCircuitJsonToPickAndPlaceCsv(circuit(overrides), {
        supplier: "jlcpcb",
        requireSupplierRotation: true,
      }),
    ).toThrow(reason)
  })
}

test("strict mode requires an explicit supplier", () => {
  expect(() =>
    convertCircuitJsonToPickAndPlaceRows(circuit(), {
      requireSupplierRotation: true,
    }),
  ).toThrow("requires a supplier")
})

test("strict mode allows verified zero adjustments and applies nonzero adjustments", () => {
  for (const [supplierLocation, rotation] of [
    ["leftside_top", 180],
    ["bottomside_left", 90],
  ] as const) {
    const rows = convertCircuitJsonToPickAndPlaceRows(
      circuit({
        pin1_location: "leftside_top",
        supplier_pin1_location_map: { jlcpcb: supplierLocation },
      }),
      { supplier: "jlcpcb", requireSupplierRotation: true },
    )
    expect(rows[0]!.rotation).toBe(rotation)
  }
})

test("generic conversion and excluded components do not report missing metadata", () => {
  const warnings: PickAndPlaceRotationWarning[] = []
  expect(
    convertCircuitJsonToPickAndPlaceRows(circuit(), {
      onRotationWarning: (warning) => warnings.push(warning),
    })[0]!.rotation,
  ).toBe(180)
  expect(
    convertCircuitJsonToPickAndPlaceRows(circuit({ do_not_place: true }), {
      supplier: "jlcpcb",
      requireSupplierRotation: true,
    }),
  ).toEqual([])
  const testpoint = circuit()
  testpoint[0] = {
    ...testpoint[0],
    ftype: "simple_test_point",
  } as AnyCircuitElement
  expect(
    convertCircuitJsonToPickAndPlaceRows(testpoint, {
      supplier: "jlcpcb",
      requireSupplierRotation: true,
    }),
  ).toEqual([])
  expect(warnings).toEqual([])
})
