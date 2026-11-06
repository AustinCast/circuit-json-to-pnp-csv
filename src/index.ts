import { su } from "@tscircuit/soup-util"
import {
  type AnyCircuitElement,
  type LayerRef,
  type PcbComponent,
  type SupplierName,
  getRotationBetweenPcbPin1Locations,
} from "circuit-json"
import Papa from "papaparse"
import { isBareMountingHole } from "./is-bare-mounting-hole"

export interface PickAndPlaceRow {
  designator: string
  mid_x: number
  mid_y: number
  layer: LayerRef
  rotation: number
}

export interface PickAndPlaceRotationWarning {
  designator: string
  pcb_component_id: string
  supplier: SupplierName
  reason:
    | "missing_pin1_location"
    | "missing_supplier_pin1_location"
    | "incompatible_pin1_locations"
  message: string
}

export interface PickAndPlaceConversionOptions {
  flip_y_axis?: boolean
  /**
   * Adjust component rotations from the authored footprint's pin-1 frame to
   * the selected supplier footprint's pin-1 frame when both are available.
   */
  supplier?: SupplierName
  /** Reject unresolved supplier rotations instead of using the PCB rotation. */
  requireSupplierRotation?: boolean
  /** Called for each unresolved rotation. Defaults to console.warn. */
  onRotationWarning?: (warning: PickAndPlaceRotationWarning) => void
}

const fixedDecimals = 3

const normalizeRotation = (rotation: number): number =>
  ((rotation % 360) + 360) % 360

const getPickAndPlaceRotation = (
  pcbComponent: PcbComponent,
  designator: string,
  opts: PickAndPlaceConversionOptions,
): number => {
  const { supplier } = opts
  if (!supplier) return pcbComponent.rotation

  const unresolved = (
    reason: PickAndPlaceRotationWarning["reason"],
  ): number => {
    const message = `${designator}: cannot verify ${supplier} pick-and-place rotation (${reason}); PCB rotation ${pcbComponent.rotation} is unverified.`
    if (opts.requireSupplierRotation) throw new Error(message)
    const warning = {
      designator,
      pcb_component_id: pcbComponent.pcb_component_id,
      supplier,
      reason,
      message,
    }
    if (opts.onRotationWarning) opts.onRotationWarning(warning)
    else console.warn(message)
    return pcbComponent.rotation
  }

  if (!pcbComponent.pin1_location) return unresolved("missing_pin1_location")
  const supplierPin1Location =
    pcbComponent.supplier_pin1_location_map?.[supplier]
  if (!supplierPin1Location) return unresolved("missing_supplier_pin1_location")

  const rotationAdjustment = getRotationBetweenPcbPin1Locations(
    supplierPin1Location,
    pcbComponent.pin1_location,
  )
  if (rotationAdjustment === null)
    return unresolved("incompatible_pin1_locations")

  return normalizeRotation(pcbComponent.rotation + rotationAdjustment)
}

export const convertCircuitJsonToPickAndPlaceRows = (
  circuitJson: AnyCircuitElement[],
  opts: PickAndPlaceConversionOptions = {},
): PickAndPlaceRow[] => {
  if (opts.requireSupplierRotation && !opts.supplier) {
    throw new Error("requireSupplierRotation requires a supplier")
  }
  const rows: PickAndPlaceRow[] = []
  for (const element of circuitJson) {
    if (element.type === "pcb_component") {
      if (element.do_not_place) continue

      const source_component = su(circuitJson).source_component.get(
        element.source_component_id,
      )
      if (!source_component) continue
      if (source_component.ftype === "simple_test_point") continue

      if (isBareMountingHole(circuitJson, source_component, element)) continue

      const designator = source_component.name ?? element.pcb_component_id
      const placementPosition = element.footprint_origin ?? element.center
      rows.push({
        designator,
        mid_x: placementPosition.x,
        mid_y: placementPosition.y * (opts.flip_y_axis ? -1 : 1),
        layer: element.layer,
        rotation: getPickAndPlaceRotation(element, designator, opts),
      })
    }
  }
  return rows
}

export const convertCircuitJsonToPickAndPlaceCsv = (
  circuitJson: AnyCircuitElement[],
  opts: PickAndPlaceConversionOptions = {},
): string =>
  Papa.unparse(
    convertCircuitJsonToPickAndPlaceRows(circuitJson, opts).map((row) => ({
      Designator: row.designator,
      "Mid X": row.mid_x.toFixed(fixedDecimals),
      "Mid Y": row.mid_y.toFixed(fixedDecimals),
      Layer: row.layer,
      Rotation: row.rotation,
    })),
  )

export {
  populatePartOrientationMetadata,
  type PartOrientationOptions,
} from "./populate-part-orientation-metadata"
