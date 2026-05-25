type ScopeMode = 'current-page' | 'all-pages'

type UiMessage =
  | { type: 'ui-ready' }
  | { type: 'refresh-selection' }
  | {
      type: 'analyze'
      canonicalId: string
      variantIds: string[]
      scope: ScopeMode
      removeDuplicateVariants: boolean
      syncDuplicateVariants: boolean
    }
  | {
      type: 'apply'
      canonicalId: string
      variantIds: string[]
      scope: ScopeMode
      removeDuplicateVariants: boolean
      syncDuplicateVariants: boolean
    }

type VariantSummary = {
  id: string
  name: string
  width: number
  height: number
  variantProps: string
  selected: boolean
  isDefault: boolean
  fingerprint: string
  previewDataUrl: string
  previewError: string
}

type DuplicateGroup = {
  id: string
  label: string
  variantIds: string[]
}

type SelectionPayload = {
  ok: boolean
  message: string
  componentSetId: string
  componentSetName: string
  variants: VariantSummary[]
  selectedVariantIds: string[]
  canonicalId: string
  duplicateGroups: DuplicateGroup[]
  issues: string[]
}

type InstanceTargetReport = {
  id: string
  name: string
  pageName: string
  path: string
  fromVariantId: string
  fromVariantName: string
}

type IssueReport = {
  level: 'info' | 'warning' | 'error'
  message: string
}

type PlanReport = {
  componentSetName: string
  canonicalName: string
  duplicateVariantNames: string[]
  scope: ScopeMode
  targetCount: number
  targets: InstanceTargetReport[]
  issues: IssueReport[]
}

type ApplyReport = PlanReport & {
  appliedCount: number
  failedCount: number
  syncedVariantNames: string[]
  removedVariantNames: string[]
}

type InternalTarget = {
  instance: InstanceNode
  report: InstanceTargetReport
}

type InternalPlan = {
  componentSet: ComponentSetNode
  canonical: ComponentNode
  duplicates: ComponentNode[]
  report: PlanReport
  targets: InternalTarget[]
}

figma.showUI(__html__, {
  width: 520,
  height: 680,
  themeColors: false
})

figma.ui.onmessage = function (message: UiMessage) {
  handleUiMessage(message).catch(function (error) {
    send({
      type: 'error',
      message: errorToMessage(error)
    })
    figma.notify(errorToMessage(error), { error: true })
  })
}

async function handleUiMessage(message: UiMessage): Promise<void> {
  if (message.type === 'ui-ready' || message.type === 'refresh-selection') {
    await sendSelection(false)
    return
  }

  if (message.type === 'analyze') {
    send({ type: 'busy', message: 'Считаю instances' })
    const plan = await buildPlan(
      message.canonicalId,
      message.variantIds,
      message.scope,
      message.removeDuplicateVariants,
      message.syncDuplicateVariants
    )
    send({ type: 'plan', payload: plan.report })
    return
  }

  if (message.type === 'apply') {
    send({ type: 'busy', message: 'Перепривязываю instances' })
    const result = await applyPlan(
      message.canonicalId,
      message.variantIds,
      message.scope,
      message.removeDuplicateVariants,
      message.syncDuplicateVariants
    )
    send({ type: 'apply-result', payload: result })
    await sendSelection(true)
    figma.notify(
      'One Variants: instances ' +
        String(result.appliedCount) +
        ', variants ' +
        String(result.syncedVariantNames.length)
    )
    return
  }
}

function send(message: unknown): void {
  figma.ui.postMessage(message)
}

async function sendSelection(preserveResult: boolean): Promise<void> {
  send({ type: 'busy', message: 'Готовлю previews' })
  await figma.currentPage.loadAsync()
  const payload = await getSelectionPayload()
  send({ type: 'selection-state', payload: payload, preserveResult: preserveResult })
}

async function getSelectionPayload(): Promise<SelectionPayload> {
  const issues: string[] = []
  const selection = figma.currentPage.selection
  const selectedVariants: ComponentNode[] = []
  const selectedSets: ComponentSetNode[] = []

  for (let index = 0; index < selection.length; index += 1) {
    const node = selection[index]
    if (node.type === 'COMPONENT_SET') {
      selectedSets.push(node)
    }
    if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') {
      selectedVariants.push(node)
    }
  }

  let componentSet: ComponentSetNode | null = null

  if (selectedVariants.length > 0) {
    const parent = selectedVariants[0].parent
    if (parent && parent.type === 'COMPONENT_SET') {
      componentSet = parent
      for (let index = 1; index < selectedVariants.length; index += 1) {
        if (selectedVariants[index].parent !== componentSet) {
          return emptySelection('Выбраны variants из разных component set. Выдели варианты внутри одного набора.')
        }
      }
    }
  } else if (selectedSets.length === 1) {
    componentSet = selectedSets[0]
  } else if (selectedSets.length > 1) {
    return emptySelection('Выбрано несколько component sets. Оставь один набор или variants из одного набора.')
  }

  if (componentSet === null) {
    return emptySelection('Выдели component set или 2+ variants внутри одного component set.')
  }

  const variants = getComponentVariants(componentSet)
  if (variants.length < 2) {
    return emptySelection('В component set меньше двух variants. Сливать нечего.')
  }

  const selectedIds: string[] = []
  for (let index = 0; index < selectedVariants.length; index += 1) {
    selectedIds.push(selectedVariants[index].id)
  }

  const summaries: VariantSummary[] = []
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]
    summaries.push({
      id: variant.id,
      name: variant.name,
      width: roundNumber(variant.width),
      height: roundNumber(variant.height),
      variantProps: formatVariantProps(variant.variantProperties),
      selected: selectedIds.indexOf(variant.id) >= 0,
      isDefault: componentSet.defaultVariant.id === variant.id,
      fingerprint: fingerprintComponent(variant),
      previewDataUrl: '',
      previewError: ''
    })
  }

  for (let index = 0; index < summaries.length; index += 1) {
    const preview = await exportVariantPreview(variants[index])
    summaries[index].previewDataUrl = preview.dataUrl
    summaries[index].previewError = preview.error
  }

  const groups = buildDuplicateGroups(summaries)
  let canonicalId = componentSet.defaultVariant.id
  if (selectedIds.length > 0) {
    canonicalId = selectedIds[0]
  } else if (groups.length > 0 && groups[0].variantIds.length > 0) {
    canonicalId = groups[0].variantIds[0]
  }

  if (selectedIds.length === 1) {
    issues.push('Выбран только один variant. Отметь еще хотя бы один duplicate variant в списке.')
  }

  return {
    ok: true,
    message: 'Найден component set',
    componentSetId: componentSet.id,
    componentSetName: componentSet.name,
    variants: summaries,
    selectedVariantIds: selectedIds,
    canonicalId: canonicalId,
    duplicateGroups: groups,
    issues: issues
  }
}

function emptySelection(message: string): SelectionPayload {
  return {
    ok: false,
    message: message,
    componentSetId: '',
    componentSetName: '',
    variants: [],
    selectedVariantIds: [],
    canonicalId: '',
    duplicateGroups: [],
    issues: []
  }
}

async function exportVariantPreview(variant: ComponentNode): Promise<{ dataUrl: string; error: string }> {
  try {
    const bytes = await variant.exportAsync({
      format: 'PNG',
      contentsOnly: true,
      constraint: {
        type: 'WIDTH',
        value: 180
      }
    })
    return {
      dataUrl: 'data:image/png;base64,' + figma.base64Encode(bytes),
      error: ''
    }
  } catch (error) {
    return {
      dataUrl: '',
      error: errorToMessage(error)
    }
  }
}

function getComponentVariants(componentSet: ComponentSetNode): ComponentNode[] {
  const variants: ComponentNode[] = []
  const children = componentSet.children
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.type === 'COMPONENT') {
      variants.push(child)
    }
  }
  return variants
}

async function buildPlan(
  canonicalId: string,
  variantIds: string[],
  scope: ScopeMode,
  removeDuplicateVariants: boolean,
  syncDuplicateVariants: boolean
): Promise<InternalPlan> {
  if (removeDuplicateVariants && scope !== 'all-pages') {
    throw new Error('Удаление duplicate variants доступно только со scope All pages.')
  }

  const canonicalNode = await figma.getNodeByIdAsync(canonicalId)
  if (canonicalNode === null || canonicalNode.type !== 'COMPONENT') {
    throw new Error('Canonical variant не найден или больше не является component.')
  }

  if (!canonicalNode.parent || canonicalNode.parent.type !== 'COMPONENT_SET') {
    throw new Error('Canonical variant должен быть внутри component set.')
  }

  const componentSet = canonicalNode.parent
  const uniqueIds = uniqueStrings(variantIds)
  if (uniqueIds.indexOf(canonicalId) < 0) {
    uniqueIds.push(canonicalId)
  }

  if (uniqueIds.length < 2) {
    throw new Error('Для merge нужно выбрать минимум два variants.')
  }

  const duplicates: ComponentNode[] = []
  const duplicateNames: string[] = []

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const id = uniqueIds[index]
    const node = await figma.getNodeByIdAsync(id)
    if (node === null || node.type !== 'COMPONENT') {
      throw new Error('Один из выбранных variants больше не найден: ' + id)
    }
    if (node.parent !== componentSet) {
      throw new Error('Все variants должны быть внутри одного component set.')
    }
    if (id !== canonicalId) {
      duplicates.push(node)
      duplicateNames.push(node.name)
    }
  }

  if (duplicates.length === 0) {
    throw new Error('Не выбраны duplicate variants для перепривязки.')
  }

  const targetMap: { [id: string]: InternalTarget } = {}
  const issues: IssueReport[] = []

  for (let index = 0; index < duplicates.length; index += 1) {
    const duplicate = duplicates[index]
    const instances = await duplicate.getInstancesAsync()
    for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex += 1) {
      const instance = instances[instanceIndex]
      if (targetMap[instance.id]) {
        continue
      }

      if (isDescendantOf(instance, componentSet)) {
        issues.push({
          level: 'info',
          message: 'Пропущен instance внутри исходного component set: ' + getNodePath(instance)
        })
        continue
      }

      const page = getPage(instance)
      if (scope === 'current-page' && page && page.id !== figma.currentPage.id) {
        continue
      }

      const pageName = page ? page.name : 'Unknown page'
      targetMap[instance.id] = {
        instance: instance,
        report: {
          id: instance.id,
          name: instance.name,
          pageName: pageName,
          path: getNodePath(instance),
          fromVariantId: duplicate.id,
          fromVariantName: duplicate.name
        }
      }
    }
  }

  const targets: InternalTarget[] = []
  const targetIds = Object.keys(targetMap)
  targetIds.sort()
  for (let index = 0; index < targetIds.length; index += 1) {
    targets.push(targetMap[targetIds[index]])
  }

  if (targets.length === 0) {
    issues.push({
      level: 'warning',
      message: 'Instances выбранных duplicate variants в этом scope не найдены.'
    })
  }

  if (syncDuplicateVariants) {
    issues.push({
      level: 'info',
      message: 'Apply также обновит выбранные duplicate variants по canonical, поэтому previews изменятся даже при 0 найденных instances.'
    })
  }

  const targetReports: InstanceTargetReport[] = []
  for (let index = 0; index < targets.length; index += 1) {
    targetReports.push(targets[index].report)
  }

  return {
    componentSet: componentSet,
    canonical: canonicalNode,
    duplicates: duplicates,
    targets: targets,
    report: {
      componentSetName: componentSet.name,
      canonicalName: canonicalNode.name,
      duplicateVariantNames: duplicateNames,
      scope: scope,
      targetCount: targets.length,
      targets: targetReports,
      issues: issues
    }
  }
}

async function applyPlan(
  canonicalId: string,
  variantIds: string[],
  scope: ScopeMode,
  removeDuplicateVariants: boolean,
  syncDuplicateVariants: boolean
): Promise<ApplyReport> {
  const plan = await buildPlan(canonicalId, variantIds, scope, removeDuplicateVariants, syncDuplicateVariants)
  const issues = cloneIssues(plan.report.issues)
  let appliedCount = 0
  let failedCount = 0

  for (let index = 0; index < plan.targets.length; index += 1) {
    const target = plan.targets[index]
    try {
      target.instance.swapComponent(plan.canonical)
      const main = await target.instance.getMainComponentAsync()
      if (main && main.id === plan.canonical.id) {
        appliedCount += 1
      } else {
        failedCount += 1
        issues.push({
          level: 'error',
          message: 'Figma приняла swap, но instance не оказался на canonical: ' + target.report.path
        })
      }
    } catch (error) {
      failedCount += 1
      issues.push({
        level: 'error',
        message: 'Не удалось перепривязать ' + target.report.path + ': ' + errorToMessage(error)
      })
    }
  }

  const syncedVariantNames: string[] = []
  if (syncDuplicateVariants) {
    for (let index = 0; index < plan.duplicates.length; index += 1) {
      const duplicate = plan.duplicates[index]
      try {
        syncVariantToCanonical(plan.canonical, duplicate)
        syncedVariantNames.push(duplicate.name)
      } catch (error) {
        failedCount += 1
        issues.push({
          level: 'error',
          message: 'Не удалось обновить variant ' + duplicate.name + ': ' + errorToMessage(error)
        })
      }
    }
  }

  const removedVariantNames: string[] = []
  if (removeDuplicateVariants) {
    const remaining = await countRemainingInstances(plan.duplicates)
    if (remaining > 0) {
      issues.push({
        level: 'warning',
        message: 'Duplicate variants не удалены: после apply осталось instances: ' + String(remaining)
      })
    } else if (failedCount > 0) {
      issues.push({
        level: 'warning',
        message: 'Duplicate variants не удалены, потому что часть swaps завершилась с ошибками.'
      })
    } else {
      for (let index = 0; index < plan.duplicates.length; index += 1) {
        const duplicate = plan.duplicates[index]
        removedVariantNames.push(duplicate.name)
        duplicate.remove()
      }
    }
  }

  const finalSelection: SceneNode[] = [plan.canonical]
  if (!removeDuplicateVariants) {
    for (let index = 0; index < plan.duplicates.length; index += 1) {
      finalSelection.push(plan.duplicates[index])
    }
  }
  figma.currentPage.selection = finalSelection
  figma.viewport.scrollAndZoomIntoView(finalSelection)

  return {
    componentSetName: plan.report.componentSetName,
    canonicalName: plan.report.canonicalName,
    duplicateVariantNames: plan.report.duplicateVariantNames,
    scope: plan.report.scope,
    targetCount: plan.report.targetCount,
    targets: plan.report.targets,
    issues: issues,
    appliedCount: appliedCount,
    failedCount: failedCount,
    syncedVariantNames: syncedVariantNames,
    removedVariantNames: removedVariantNames
  }
}

function syncVariantToCanonical(canonical: ComponentNode, duplicate: ComponentNode): void {
  const originalName = duplicate.name
  const originalX = duplicate.x
  const originalY = duplicate.y

  copyRootProperties(canonical, duplicate)

  const children = Array.from(duplicate.children)
  for (let index = 0; index < children.length; index += 1) {
    children[index].remove()
  }

  const canonicalChildren = canonical.children
  for (let index = 0; index < canonicalChildren.length; index += 1) {
    duplicate.appendChild(canonicalChildren[index].clone())
  }

  duplicate.name = originalName
  duplicate.x = originalX
  duplicate.y = originalY
}

function copyRootProperties(source: ComponentNode, target: ComponentNode): void {
  trySet(function () {
    target.resizeWithoutConstraints(source.width, source.height)
  })

  const properties = [
    'fills',
    'strokes',
    'strokeWeight',
    'strokeAlign',
    'strokeCap',
    'strokeJoin',
    'dashPattern',
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomRightRadius',
    'bottomLeftRadius',
    'cornerSmoothing',
    'opacity',
    'blendMode',
    'effects',
    'clipsContent',
    'layoutMode',
    'layoutWrap',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'counterAxisAlignContent',
    'layoutAlign',
    'layoutGrow',
    'itemSpacing',
    'counterAxisSpacing',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'paddingBottom',
    'layoutGrids'
  ]

  const sourceAny = source as unknown as { [key: string]: unknown }
  const targetAny = target as unknown as { [key: string]: unknown }
  for (let index = 0; index < properties.length; index += 1) {
    const key = properties[index]
    if (key in sourceAny && key in targetAny) {
      trySet(function () {
        targetAny[key] = cloneSerializable(sourceAny[key])
      })
    }
  }
}

function trySet(operation: () => void): void {
  try {
    operation()
  } catch (_error) {
    // Some visual/layout fields are read-only or invalid depending on the node state.
  }
}

function cloneSerializable<T>(value: T): T {
  if (value === figma.mixed) {
    return value
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  return JSON.parse(JSON.stringify(value)) as T
}

async function countRemainingInstances(duplicates: ComponentNode[]): Promise<number> {
  let count = 0
  for (let index = 0; index < duplicates.length; index += 1) {
    const instances = await duplicates[index].getInstancesAsync()
    count += instances.length
  }
  return count
}

function cloneIssues(issues: IssueReport[]): IssueReport[] {
  const copy: IssueReport[] = []
  for (let index = 0; index < issues.length; index += 1) {
    copy.push({
      level: issues[index].level,
      message: issues[index].message
    })
  }
  return copy
}

function buildDuplicateGroups(variants: VariantSummary[]): DuplicateGroup[] {
  const byFingerprint: { [fingerprint: string]: VariantSummary[] } = {}
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]
    if (!byFingerprint[variant.fingerprint]) {
      byFingerprint[variant.fingerprint] = []
    }
    byFingerprint[variant.fingerprint].push(variant)
  }

  const groups: DuplicateGroup[] = []
  const fingerprints = Object.keys(byFingerprint)
  fingerprints.sort()
  for (let index = 0; index < fingerprints.length; index += 1) {
    const groupVariants = byFingerprint[fingerprints[index]]
    if (groupVariants.length < 2) {
      continue
    }
    const ids: string[] = []
    const names: string[] = []
    for (let variantIndex = 0; variantIndex < groupVariants.length; variantIndex += 1) {
      ids.push(groupVariants[variantIndex].id)
      names.push(groupVariants[variantIndex].name)
    }
    groups.push({
      id: 'group-' + String(groups.length + 1),
      label: names.join(' + '),
      variantIds: ids
    })
  }
  return groups
}

function fingerprintComponent(component: ComponentNode): string {
  const summary = summarizeSceneNode(component, 0)
  return stableStringify(summary)
}

function summarizeSceneNode(node: SceneNode, depth: number): unknown {
  const base: { [key: string]: unknown } = {
    type: node.type,
    visible: node.visible,
    width: hasSize(node) ? roundNumber(node.width) : 0,
    height: hasSize(node) ? roundNumber(node.height) : 0
  }

  if (hasOpacity(node)) {
    base.opacity = roundNumber(node.opacity)
  }

  if (hasFills(node)) {
    base.fills = summarizePaints(node.fills)
  }

  if (hasStrokes(node)) {
    base.strokes = summarizePaints(node.strokes)
    base.strokeWeight = mixedToString(node.strokeWeight)
  }

  if (hasCornerRadius(node)) {
    base.cornerRadius = mixedToString(node.cornerRadius)
  }

  if (hasLayout(node)) {
    base.layoutMode = node.layoutMode
    base.itemSpacing = mixedToString(node.itemSpacing)
    base.paddingLeft = roundNumber(node.paddingLeft)
    base.paddingRight = roundNumber(node.paddingRight)
    base.paddingTop = roundNumber(node.paddingTop)
    base.paddingBottom = roundNumber(node.paddingBottom)
  }

  if (node.type === 'TEXT') {
    base.characters = normalizeText(node.characters)
    base.fontSize = mixedToString(node.fontSize)
    base.fontName = mixedToString(node.fontName)
  }

  if (node.type === 'INSTANCE') {
    base.instanceName = node.name
  }

  if (depth < 8 && hasChildren(node)) {
    const childSummaries: unknown[] = []
    const children = node.children
    for (let index = 0; index < children.length; index += 1) {
      childSummaries.push(summarizeSceneNode(children[index], depth + 1))
    }
    base.children = childSummaries
  }

  return base
}

function summarizePaints(paints: ReadonlyArray<Paint> | PluginAPI['mixed']): string {
  if (paints === figma.mixed) {
    return 'mixed'
  }

  const parts: string[] = []
  for (let index = 0; index < paints.length; index += 1) {
    const paint = paints[index]
    if (!paint.visible) {
      continue
    }
    if (paint.type === 'SOLID') {
      parts.push(
        [
          'SOLID',
          roundNumber(paint.color.r),
          roundNumber(paint.color.g),
          roundNumber(paint.color.b),
          typeof paint.opacity === 'number' ? roundNumber(paint.opacity) : 1
        ].join(':')
      )
    } else {
      parts.push(paint.type)
    }
  }
  return parts.join('|')
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const items: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      items.push(stableStringify(value[index]))
    }
    return '[' + items.join(',') + ']'
  }
  const record = value as { [key: string]: unknown }
  const keys = Object.keys(record)
  keys.sort()
  const parts: string[] = []
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    parts.push(JSON.stringify(key) + ':' + stableStringify(record[key]))
  }
  return '{' + parts.join(',') + '}'
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

function hasSize(node: SceneNode): node is SceneNode & { width: number; height: number } {
  return 'width' in node && 'height' in node
}

function hasOpacity(node: SceneNode): node is SceneNode & { opacity: number } {
  return 'opacity' in node
}

function hasFills(node: SceneNode): node is SceneNode & MinimalFillsMixin {
  return 'fills' in node
}

function hasStrokes(node: SceneNode): node is SceneNode & MinimalStrokesMixin {
  return 'strokes' in node
}

function hasCornerRadius(node: SceneNode): node is SceneNode & CornerMixin {
  return 'cornerRadius' in node
}

function hasLayout(node: SceneNode): node is SceneNode & AutoLayoutMixin {
  return 'layoutMode' in node && 'paddingLeft' in node
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function mixedToString(value: unknown): string {
  if (value === figma.mixed) {
    return 'mixed'
  }
  if (typeof value === 'number') {
    return String(roundNumber(value))
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === null) {
    return 'null'
  }
  return JSON.stringify(value)
}

function formatVariantProps(props: { [property: string]: string } | null): string {
  if (props === null) {
    return ''
  }
  const keys = Object.keys(props)
  keys.sort()
  const parts: string[] = []
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    parts.push(key + '=' + props[key])
  }
  return parts.join(', ')
}

function uniqueStrings(values: string[]): string[] {
  const seen: { [key: string]: true } = {}
  const result: string[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!seen[value]) {
      seen[value] = true
      result.push(value)
    }
  }
  return result
}

function getPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node
  while (current) {
    if (current.type === 'PAGE') {
      return current
    }
    current = current.parent
  }
  return null
}

function getNodePath(node: BaseNode): string {
  const names: string[] = []
  let current: BaseNode | null = node
  while (current) {
    if ('name' in current) {
      names.unshift(current.name)
    }
    if (current.type === 'PAGE') {
      break
    }
    current = current.parent
  }
  return names.join(' / ')
}

function isDescendantOf(node: BaseNode, ancestor: BaseNode): boolean {
  let current: BaseNode | null = node.parent
  while (current) {
    if (current === ancestor) {
      return true
    }
    current = current.parent
  }
  return false
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
