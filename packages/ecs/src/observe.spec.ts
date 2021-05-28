import { arrayOf, mapOf, number, objectOf, setOf } from "@javelin/core"
import { component } from "../dist/cjs"
import {
  $changes,
  $delete,
  observe,
  ObservedArray,
  ObservedMap,
  ObservedObject,
  ObservedSet,
  ObservedStruct,
} from "./observe"

const Vec2 = { x: number, y: number }

describe("observe", () => {
  it("observes simple schema changes", () => {
    const c = component(Vec2)
    const o = observe(c)
    const x = 1
    const y = 2
    o.x = x
    o.y = y
    const { changes } = (o as unknown as ObservedStruct)[$changes]
    expect(o.x).toBe(x)
    expect(o.y).toBe(y)
    expect(changes.x).toBe(x)
    expect(changes.y).toBe(y)
  })
  it("observes nested schema changes", () => {
    const c = component({ position: Vec2 })
    const o = observe(c)
    const x = 1
    const y = 2
    o.position.x = x
    o.position.y = y
    const { changes } = (o.position as unknown as ObservedStruct)[$changes]
    expect(o.position.x).toBe(x)
    expect(o.position.y).toBe(y)
    expect(changes.x).toBe(x)
    expect(changes.y).toBe(y)
  })
  it("observes array changes", () => {
    const c = component({ array: arrayOf(number) })
    const o = observe(c)
    const v = 111
    o.array.push(v)
    const { changes } = (o.array as unknown as ObservedArray)[$changes]
    expect(changes[0]).toBe(v)
    expect(changes.length).toBe(1)
  })
  it("observes complex array elements", () => {
    const c = component({ array: arrayOf(Vec2) })
    const o = observe(c)
    const x = 4
    const y = 2
    o.array.push({ x, y })
    o.array[0].x++
    o.array[0].y++
    const { changes } = (o.array[0] as unknown as ObservedStruct)[$changes]
    expect(changes.x).toBe(x + 1)
    expect(changes.y).toBe(y + 1)
  })
  it("observes object property assignment", () => {
    const c = component({ object: objectOf(number) })
    const o = observe(c)
    const k = "torque"
    const v = 111
    o.object[k] = v
    const { changes } = (o.object as unknown as ObservedObject)[$changes]
    expect(changes[k]).toBe(v)
  })
  it("observes object property deletion", () => {
    const c = component({ object: objectOf(number) })
    const o = observe(c)
    const k = "torque"
    const v = 111
    o.object[k] = v
    delete o.object[k]
    const { changes } = (o.object as unknown as ObservedObject)[$changes]
    expect(changes[k]).toBe($delete)
  })
  it("observes complex object properties", () => {
    const c = component({ object: objectOf(Vec2) })
    const o = observe(c)
    const k = "torque"
    const x = 4
    const y = 2
    o.object[k] = { x, y }
    o.object[k].x++
    o.object[k].y++
    const { changes } = (o.object.torque as unknown as ObservedObject)[$changes]
    expect(changes.x).toBe(x + 1)
    expect(changes.y).toBe(y + 1)
  })
  it("observes Set.prototype.add", () => {
    const c = component({ set: setOf(number) })
    const o = observe(c)
    const v = 111
    o.set.add(v)
    const changes = (o.set as unknown as ObservedSet)[$changes]
    expect(changes.add).toContain(v)
  })
  it("observes Set.prototype.delete", () => {
    const c = component({ set: setOf(number) })
    const o = observe(c)
    const v = 111
    o.set.add(v)
    o.set.delete(v)
    const changes = (o.set as unknown as ObservedSet)[$changes]
    expect(changes.delete).toContain(v)
  })
  it.todo("observes Set.prototype.clear")
  it("observes Map.prototype.set", () => {
    const c = component({ map: mapOf(number, number) })
    const o = observe(c)
    const k = 8
    const v = 9
    o.map.set(k, v)
    const { changes } = (o.map as unknown as ObservedMap)[$changes]
    expect(changes.get(k)).toBe(v)
  })
  it("observes Map.prototype.delete", () => {
    const c = component({ map: mapOf(number, number) })
    const o = observe(c)
    const k = 8
    o.map.set(k, 9)
    o.map.delete(k)
    const { changes } = (o.map as unknown as ObservedMap)[$changes]
    expect(changes.get(k)).toBe($delete)
  })
  it.todo("observes Map.prototype.clear")
  it("observes complex map values", () => {
    const c = component({ map: mapOf(number, Vec2) })
    const o = observe(c)
    const k = 111
    const x = 4
    const y = 2
    o.map.set(k, { x, y })
    o.map.get(k)!.x++
    o.map.get(k)!.y++
    const { changes } = (o.map.get(k) as unknown as ObservedStruct)[$changes]
    expect(changes.x).toBe(x + 1)
    expect(changes.y).toBe(y + 1)
  })
})