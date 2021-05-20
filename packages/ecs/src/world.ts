import { assert, createStackPool, mutableEmpty, Schema } from "@javelin/core"
import { Component, ComponentOf, registerSchema } from "./component"
import { Entity } from "./entity"
import { UNSAFE_internals } from "./internal"
import { createStorage, Storage, StorageSnapshot } from "./storage"
import { Topic } from "./topic"

const $systemId = Symbol("javelin_system_id")

export enum DeferredOpType {
  Spawn,
  Attach,
  Detach,
  Mutate,
  Destroy,
}

export type Spawn = [DeferredOpType.Spawn, number, Component[]]
export type Attach = [DeferredOpType.Attach, number, Component[]]
export type Detach = [DeferredOpType.Detach, number, number[]]
export type Destroy = [DeferredOpType.Destroy, number]

export type WorldOp = Spawn | Attach | Detach | Destroy
export type World<T = unknown> = {
  /**
   * Unique world identifier.
   */
  readonly id: number

  /**
   * Entity-component storage.
   */
  readonly storage: Storage

  /**
   * Latest step number.
   */
  readonly latestStep: number

  /**
   * Latest step data passed to world.step().
   */
  readonly latestStepData: T

  /**
   * Id of the latest invoked system.
   */
  readonly latestSystem: number

  /**
   * Process operations from previous step and execute all systems.
   * @param data Step data
   */
  step(data: T): void

  /**
   * Register a system to be executed each step.
   * @param system
   */
  addSystem(system: System<T>): void

  /**
   * Remove a system.
   * @param system
   */
  removeSystem(system: System<T>): void

  /**
   * Register a topic to be flushed each step.
   * @param topic
   */
  addTopic(topic: Topic): void

  /**
   * Remove a topic.
   * @param topic
   */
  removeTopic(topic: Topic): void

  /**
   * Create an entity and optionally attach components.
   * @param components The new entity's components
   */
  create(...components: ReadonlyArray<Component>): number

  /**
   * Attach components to an entity. Deferred until next tick.
   * @param entity Entity
   * @param components Components to attach to `entity`
   */
  attach(entity: number, ...components: ReadonlyArray<Component>): void

  /**
   * Attach components to an entity.
   * @param entity Entity
   * @param components Components to attach to `entity`
   */
  attachImmediate(entity: Entity, components: Component[]): void

  /**
   * Remove attached components from an entity. Deffered until next tick.
   * @param entity Entity
   * @param components Components to detach from `entity`
   */
  detach(entity: number, ...components: (Schema | Component | number)[]): void

  /**
   * Remove attached components from an entity.
   * @param entity Entity
   * @param components Components to detach from `entity`
   */
  detachImmediate(entity: Entity, schemaIds: number[]): void

  /**
   * Remove all components from an entity. Deferred until next tick.
   * @param entity Entity
   */
  destroy(entity: number): void

  /**
   * Remove all components from an entity.
   * @param entity Entity
   */
  destroyImmediate(entity: Entity): void

  /**
   * Find the component of an entity by type. Throws an error if component is not found.
   * @param entity
   * @param schema
   */
  get<T extends Schema>(entity: number, schema: T): ComponentOf<T>

  /**
   * Find the component of an entity by type, or null if a component is not found.
   * @param entity
   * @param schema
   */
  tryGet<T extends Schema>(entity: number, schema: T): ComponentOf<T> | null

  /**
   * Check if an entity has a component of a specified schema.
   * @param entity
   * @param schema
   */
  has(entity: number, schema: Schema): boolean

  /**
   * Reset the world to its initial state, removing all entities, components,
   * systems, topics, and deferred operations.
   */
  reset(): void

  /**
   * Create a serializable snapshot of the world that can be restored later.
   */
  getSnapshot(): WorldSnapshot
}

export type WorldSnapshot = {
  storage: StorageSnapshot
}

export type System<T> = ((world: World<T>) => void) & {
  [$systemId]?: number
}

export type WorldOptions<T> = {
  /**
   * Number of components to initialize component pools with. Can be overriden
   * for a specific component type via `registerSchema`.
   */
  componentPoolSize?: number
  /**
   * Snapshot to hydrate world from.
   */
  snapshot?: WorldSnapshot
  /**
   * Systems to execute each step.
   */
  systems?: System<T>[]
  /**
   * Topics to flush at the end of each step.
   */
  topics?: Topic[]
}

/**
 * Create a world.
 * @param options WorldOptions
 * @returns World
 */
export function createWorld<T = void>(options: WorldOptions<T> = {}): World<T> {
  const { topics = [] } = options
  const systems: System<T>[] = []
  const deferredOps: WorldOp[] = []
  const deferredOpsPool = createStackPool<WorldOp>(
    () => [] as any as WorldOp,
    op => {
      mutableEmpty(op)
      return op
    },
    1000,
  )
  const destroyed = new Set<number>()
  const storage = createStorage({ snapshot: options.snapshot?.storage })

  let entityIds = 0
  let systemIds = 0

  options.systems?.forEach(addSystem)

  function createDeferredOp<T extends WorldOp>(...args: T): T {
    const deferred = deferredOpsPool.retain() as T

    for (let i = 0; i < args.length; i++) {
      deferred[i] = args[i]
    }

    return deferred
  }

  function maybeReleaseComponent(component: Component) {
    const pool = UNSAFE_internals.schemaPools.get(component.__type__)
    if (pool) {
      pool.release(component)
    }
  }

  function addSystem(system: System<T>) {
    systems.push(system)
    system[$systemId] = systemIds++
  }

  function removeSystem(system: System<T>) {
    const index = systems.indexOf(system)
    if (index > -1) {
      systems.splice(index, 1)
    }
  }

  function addTopic(topic: Topic) {
    topics.push(topic)
  }

  function removeTopic(topic: Topic) {
    const index = topics.indexOf(topic)
    if (index > -1) {
      topics.splice(index, 1)
    }
  }

  function create(...components: Component[]) {
    const entity = entityIds++
    if (components.length > 0) {
      deferredOps.push(
        createDeferredOp(DeferredOpType.Attach, entity, components),
      )
    }
    return entity
  }

  function attach(entity: number, ...components: Component[]) {
    deferredOps.push(
      createDeferredOp(DeferredOpType.Attach, entity, components),
    )
  }

  function attachImmediate(entity: Entity, components: Component[]) {
    storage.attachComponents(entity, components)
  }

  function detach(
    entity: number,
    ...components: (Component | Schema | number)[]
  ) {
    if (components.length === 0) {
      return
    }
    const schemaIds = components.map(c =>
      typeof c === "number"
        ? c
        : UNSAFE_internals.schemaIndex.get(c) ?? (c as Component).__type__,
    )
    deferredOps.push(createDeferredOp(DeferredOpType.Detach, entity, schemaIds))
  }

  function detachImmediate(entity: Entity, schemaIds: number[]) {
    const components: Component[] = []
    for (let i = 0; i < schemaIds.length; i++) {
      const schemaId = schemaIds[i]
      const component = storage.getComponentsBySchemaId(entity, schemaId)
      assert(
        component !== null,
        `Failed to detach component: entity does not have component of type ${schemaId}`,
      )
      components.push(component)
    }
    storage.detachBySchemaId(entity, schemaIds)
    components.forEach(maybeReleaseComponent)
  }

  function destroy(entity: number) {
    if (destroyed.has(entity)) {
      return
    }
    deferredOps.push(createDeferredOp(DeferredOpType.Destroy, entity))
    destroyed.add(entity)
  }

  function destroyImmediate(entity: Entity) {
    storage.clearComponents(entity)
  }

  function has(entity: number, schema: Schema) {
    registerSchema(schema)
    return storage.hasComponentOfSchema(entity, schema)
  }

  function get<T extends Schema>(entity: number, schema: T): ComponentOf<T> {
    registerSchema(schema)
    const component = storage.getComponentsBySchema(entity, schema)

    if (component === null) {
      throw new Error("Failed to get component: entity does not have component")
    }

    return component
  }

  function tryGet<T extends Schema>(
    entity: number,
    schema: T,
  ): ComponentOf<T> | null {
    registerSchema(schema)
    return storage.getComponentsBySchema(entity, schema)
  }

  function reset() {
    destroyed.clear()
    // clear deferred ops
    while (deferredOps.length > 0) {
      deferredOpsPool.release(deferredOps.pop()!)
    }
    mutableEmpty(deferredOps)
    // remove all systems
    mutableEmpty(systems)
    // remove all topics
    topics.forEach(topic => topic.clear())
    mutableEmpty(topics)
    // reset entity id counter
    entityIds = 0
    // reset step data
    world.latestStep = -1
    world.latestStepData = null as unknown as T
    world.latestSystem = -1
    // release components
    for (let i = 0; i < storage.archetypes.length; i++) {
      const archetype = storage.archetypes[i]
      for (let j = 0; j < archetype.signature.length; j++) {
        const column = archetype.table[j]
        const componentPool = UNSAFE_internals.schemaPools.get(
          archetype.signature[j],
        )
        for (let k = 0; k < column.length; k++) {
          const component = column[k]
          componentPool?.release(component!)
        }
      }
    }
    // reset entity-component storage
    storage.reset()
  }

  function getSnapshot(): WorldSnapshot {
    return {
      storage: storage.getSnapshot(),
    }
  }

  function applyAttachOp(op: Attach) {
    const [, entity, components] = op
    attachImmediate(entity, components)
  }

  function applyDetachOp(op: Detach) {
    const [, entity, schemaIds] = op
    detachImmediate(entity, schemaIds)
  }

  function applyDestroyOp(op: Destroy) {
    const [, entity] = op
    destroyImmediate(entity)
  }

  function applyDeferredOp(deferred: WorldOp) {
    switch (deferred[0]) {
      case DeferredOpType.Attach:
        applyAttachOp(deferred)
        break
      case DeferredOpType.Detach:
        applyDetachOp(deferred)
        break
      case DeferredOpType.Destroy:
        applyDestroyOp(deferred)
        break
    }
    deferredOpsPool.release(deferred)
  }

  function step(data: T) {
    let prevWorld = UNSAFE_internals.currentWorldId
    UNSAFE_internals.currentWorldId = id
    world.latestStepData = data
    for (let i = 0; i < deferredOps.length; i++) {
      applyDeferredOp(deferredOps[i])
    }
    mutableEmpty(deferredOps)
    // flush topics
    for (let i = 0; i < topics.length; i++) {
      topics[i].flush()
    }
    // Execute systems
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i]
      world.latestSystem = system[$systemId]!
      system(world)
    }
    destroyed.clear()
    world.latestStep++
    UNSAFE_internals.currentWorldId = prevWorld
  }

  const id = UNSAFE_internals.worldIds++
  const world = {
    id,
    storage,
    latestStep: -1,
    latestStepData: null as unknown as T,
    latestSystem: -1,
    attach,
    attachImmediate,
    addSystem,
    addTopic,
    create,
    destroy,
    destroyImmediate,
    get,
    getSnapshot,
    has,
    detach,
    detachImmediate,
    removeSystem,
    removeTopic,
    reset,
    step,
    tryGet,
  }

  UNSAFE_internals.worlds.push(world)

  return world
}
