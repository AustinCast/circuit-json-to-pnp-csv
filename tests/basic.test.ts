import { describe, expect, test } from "bun:test"
import type {
  AnyCircuitElement,
  PcbComponent,
  SourceManuallyPlacedVia,
  SourceSimpleTestPoint,
} from "circuit-json"
import {
  convertCircuitJsonToPickAndPlaceCsv,
  convertCircuitJsonToPickAndPlaceRows,
} from "../src/index"

describe("circuit-json-to-pnp-csv", () => {
  const sampleSoup: AnyCircuitElement[] = [
    {
      type: "source_component",
      ftype: "simple_resistor",
      source_component_id: "source_component_1",
      name: "R1",
      resistance: 100,
    },
    {
      type: "pcb_component",
      pcb_component_id: "pcb_component_1",
      center: { x: 10, y: 20 },
      layer: "top",
      rotation: 0,
      width: 5,
      height: 2,
      source_component_id: "source_component_1",
      obstructs_within_bounds: true,
    },
    {
      type: "source_component",
      ftype: "simple_capacitor",
      source_component_id: "source_component_2",
      name: "C1",
      capacitance: 100,
    },
    {
      type: "pcb_component",
      pcb_component_id: "pcb_component_2",
      center: { x: 30, y: 40 },
      layer: "bottom",
      rotation: 90,
      width: 3,
      height: 3,
      source_component_id: "source_component_2",
      obstructs_within_bounds: true,
    },
  ]

  test("convertCircuitJsonToPickAndPlaceRows", () => {
    const rows = convertCircuitJsonToPickAndPlaceRows(sampleSoup)
    expect(rows).toEqual([
      { designator: "R1", mid_x: 10, mid_y: 20, layer: "top", rotation: 0 },
      { designator: "C1", mid_x: 30, mid_y: 40, layer: "bottom", rotation: 90 },
    ])
  })

  test("convertCircuitJsonToPickAndPlaceCsv", () => {
    const csv = convertCircuitJsonToPickAndPlaceCsv(sampleSoup)
    const expectedCsv =
      "Designator,Mid X,Mid Y,Layer,Rotation\r\nR1,10.000,20.000,top,0\r\nC1,30.000,40.000,bottom,90"
    expect(csv).toBe(expectedCsv)
  })

  test("skips pcb components without source components", () => {
    const manuallyPlacedVia: SourceManuallyPlacedVia = {
      type: "source_manually_placed_via",
      source_manually_placed_via_id: "source_manually_placed_via_1",
      source_group_id: "source_group_1",
      source_net_id: "",
    }
    const manuallyPlacedViaPcbComponent: PcbComponent = {
      type: "pcb_component",
      pcb_component_id: "pcb_component_via_1",
      center: { x: 50, y: 60 },
      layer: "top",
      rotation: 0,
      width: 0.6096,
      height: 0.6096,
      source_component_id: "source_manually_placed_via_1",
      obstructs_within_bounds: true,
    }

    const rows = convertCircuitJsonToPickAndPlaceRows([
      ...sampleSoup,
      manuallyPlacedVia,
      manuallyPlacedViaPcbComponent,
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.designator)).toEqual(["R1", "C1"])
  })

  test("skips do-not-place components", () => {
    const circuitJson = sampleSoup.map((element) => {
      if (
        element.type === "pcb_component" &&
        element.pcb_component_id === "pcb_component_2"
      ) {
        return { ...element, do_not_place: true }
      }

      return element
    }) as AnyCircuitElement[]

    const rows = convertCircuitJsonToPickAndPlaceRows(circuitJson)

    expect(rows.map((row) => row.designator)).toEqual(["R1"])
  })

  test("skips testpoints", () => {
    const testPoint: SourceSimpleTestPoint = {
      type: "source_component",
      ftype: "simple_test_point",
      source_component_id: "source_component_testpoint_1",
      name: "TP1",
      footprint_variant: "pad",
      pad_shape: "circle",
      pad_diameter: 1.2,
    }
    const testPointPcbComponent: PcbComponent = {
      type: "pcb_component",
      pcb_component_id: "pcb_component_testpoint_1",
      center: { x: 50, y: 60 },
      layer: "top",
      rotation: 0,
      width: 1.2,
      height: 1.2,
      source_component_id: testPoint.source_component_id,
      obstructs_within_bounds: true,
    }
    const circuitJson = [...sampleSoup, testPoint, testPointPcbComponent]

    const rows = convertCircuitJsonToPickAndPlaceRows(circuitJson)
    const csv = convertCircuitJsonToPickAndPlaceCsv(circuitJson)

    expect(rows.map((row) => row.designator)).toEqual(["R1", "C1"])
    expect(csv).not.toContain("TP1")
  })

  test("convertCircuitJsonToPickAndPlaceRows with flip_y_axis option", () => {
    const rows = convertCircuitJsonToPickAndPlaceRows(sampleSoup, {
      flip_y_axis: true,
    })
    expect(rows).toEqual([
      { designator: "R1", mid_x: 10, mid_y: -20, layer: "top", rotation: 0 },
      {
        designator: "C1",
        mid_x: 30,
        mid_y: -40,
        layer: "bottom",
        rotation: 90,
      },
    ])
  })

  test("adjusts top and bottom rotations for the selected supplier", () => {
    const orientationAwareSoup = sampleSoup.map((element) => {
      if (element.type !== "pcb_component") return element
      return {
        ...element,
        pin1_location: "leftside_top" as const,
        supplier_pin1_location_map: {
          jlcpcb: "bottomside_left" as const,
          pcbway: "leftside_top" as const,
        },
      }
    })

    expect(
      convertCircuitJsonToPickAndPlaceRows(orientationAwareSoup, {
        supplier: "jlcpcb",
      }).map((row) => row.rotation),
    ).toEqual([270, 0])
    expect(
      convertCircuitJsonToPickAndPlaceRows(orientationAwareSoup, {
        supplier: "pcbway",
      }).map((row) => row.rotation),
    ).toEqual([0, 90])
    expect(
      convertCircuitJsonToPickAndPlaceCsv(orientationAwareSoup, {
        supplier: "jlcpcb",
      }),
    ).toContain("C1,30.000,40.000,bottom,0")
  })

  test("preserves rotation when semantic pin-1 frames cannot be rotated into each other", () => {
    const incompatibleOrientationSoup = sampleSoup.map((element) => {
      if (element.type !== "pcb_component") return element
      return {
        ...element,
        pin1_location: "leftside_top" as const,
        supplier_pin1_location_map: {
          jlcpcb: "leftside_bottom" as const,
        },
      }
    })

    expect(
      convertCircuitJsonToPickAndPlaceRows(incompatibleOrientationSoup, {
        supplier: "jlcpcb",
      }).map((row) => row.rotation),
    ).toEqual([0, 90])
  })
})
