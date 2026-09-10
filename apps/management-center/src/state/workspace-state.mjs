export const WORKSPACE_AREAS = ['building', 'assets'];
export const BUILDING_MODES = ['preview', 'logic'];
export const PANEL_PLACEMENTS = ['docked', 'floating'];
export const PANEL_CONTEXTS = ['page', 'object'];
export const VIEWPORT_PRESETS = [
  {id: 'adaptive', label: '自适应 Web', type: 'adaptive', width: null, height: null},
  {id: 'desktop-2k', label: '桌面 2K 2560 × 1440', type: 'device', width: 2560, height: 1440},
  {id: 'desktop-1920', label: '桌面 1920 × 1080', type: 'device', width: 1920, height: 1080},
  {id: 'desktop-1440', label: '桌面 1440 × 900', type: 'device', width: 1440, height: 900},
  {id: 'laptop-1280', label: '笔记本 1280 × 800', type: 'device', width: 1280, height: 800},
  {id: 'tablet-768', label: '平板 768 × 1024', type: 'device', width: 768, height: 1024},
  {id: 'phone-390', label: '手机 390 × 844', type: 'device', width: 390, height: 844},
  {id: 'phone-375', label: '手机 375 × 812', type: 'device', width: 375, height: 812},
  {id: 'phone-320', label: '小屏手机 320 × 568', type: 'device', width: 320, height: 568}
];

export function createWorkspaceState(seed = {}) {
  const legacy = seed.workMode;
  const workspaceArea = WORKSPACE_AREAS.includes(seed.workspaceArea) ? seed.workspaceArea : legacy === 'asset_management' ? 'assets' : 'building';
  const buildingMode = BUILDING_MODES.includes(seed.buildingMode) ? seed.buildingMode : legacy === 'information_logic' ? 'logic' : 'preview';
  return {workspaceArea, buildingMode, panelPlacement: seed.panelPlacement || 'docked', panelContext: PANEL_CONTEXTS.includes(seed.panelContext) ? seed.panelContext : 'page', panelCollapsed: Boolean(seed.panelCollapsed), panelPlacementBeforeCollapse: seed.panelPlacementBeforeCollapse || seed.panelPlacement || 'docked', collapsedPosition: seed.collapsedPosition || null, collapsedPositionAtCollapse: seed.collapsedPositionAtCollapse || null, floatingPosition: seed.floatingPosition || {x: 24, y: 24}, floatingSize: seed.floatingSize || {width: 360, height: 540}, pageId: seed.pageId || null, previewRoute: seed.previewRoute || null, iframeRoute: seed.iframeRoute || null, componentId: seed.componentId || null, assetId: seed.assetId || null, instanceId: seed.instanceId || null, eventId: seed.eventId || null, eventState: seed.eventState || null, variant: seed.variant || null, componentPageId: seed.componentPageId || null, viewportPresetId: seed.viewportPresetId || 'adaptive'};
}

export function transitionWorkspace(state, action) {
  const next = {...state};
  if (action.type === 'open-assets') next.workspaceArea = 'assets';
  if (action.type === 'set-building-mode' && BUILDING_MODES.includes(action.mode)) { next.workspaceArea = 'building'; next.buildingMode = action.mode; }
  if (action.type === 'toggle-placement') next.panelPlacement = state.panelPlacement === 'docked' ? 'floating' : 'docked';
  if (action.type === 'set-panel-context' && PANEL_CONTEXTS.includes(action.context)) next.panelContext = action.context;
  if (action.type === 'collapse') {
    next.panelCollapsed = true;
    next.panelPlacementBeforeCollapse = state.panelPlacement;
    if (action.collapsedPosition) {
      next.collapsedPosition = clampFloatingPosition(action.collapsedPosition, action.workspace, action.panel || {width: 28, height: 28});
      next.collapsedPositionAtCollapse = next.collapsedPosition;
    }
  }
  if (action.type === 'restore') {
    next.panelCollapsed = false;
    next.panelPlacement = state.panelPlacementBeforeCollapse;
    if (state.panelCollapsed && state.panelPlacementBeforeCollapse === 'floating' && state.collapsedPosition && state.collapsedPositionAtCollapse && action.workspace && action.panel) {
      const delta = {x: state.collapsedPosition.x - state.collapsedPositionAtCollapse.x, y: state.collapsedPosition.y - state.collapsedPositionAtCollapse.y};
      next.floatingPosition = clampFloatingPosition({x: state.floatingPosition.x + delta.x, y: state.floatingPosition.y + delta.y}, action.workspace, action.panel);
    }
  }
  if (action.type === 'set-page') { next.pageId = action.pageId; next.previewRoute = action.route ?? null; }
  if (action.type === 'navigate-page') { next.pageId = action.pageId; next.previewRoute = null; next.iframeRoute = action.route ?? null; next.componentId = null; next.instanceId = null; next.eventId = null; next.eventState = null; next.variant = null; next.componentPageId = null; }
  if (action.type === 'set-component') { next.componentId = action.componentId; next.assetId = action.componentId; next.instanceId = action.instanceId ?? null; next.eventId = action.eventId ?? null; next.eventState = action.eventState ?? null; next.variant = action.variant ?? null; next.componentPageId = action.pageId ?? state.pageId; }
  if (action.type === 'clear-component') { next.componentId = null; next.instanceId = null; next.eventId = null; next.eventState = null; next.variant = null; next.componentPageId = null; }
  if (action.type === 'set-asset') next.assetId = action.assetId ?? null;
  if (action.type === 'set-viewport') next.viewportPresetId = action.viewportPresetId;
  if (action.type === 'set-position') next.floatingPosition = clampFloatingPosition(action.position, action.workspace, action.panel);
  if (action.type === 'set-collapsed-position') next.collapsedPosition = clampFloatingPosition(action.position, action.workspace, action.panel);
  if (action.type === 'set-floating-size') next.floatingSize = action.size;
  return next;
}

export function clampFloatingPosition(position, workspace, panel) {
  const margin = 12;
  const maxX = Math.max(margin, (workspace.width || 0) - (panel.width || 0) - margin);
  const maxY = Math.max(margin, (workspace.height || 0) - (panel.height || 0) - margin);
  return {x: Math.min(maxX, Math.max(margin, Number(position?.x) || 0)), y: Math.min(maxY, Math.max(margin, Number(position?.y) || 0))};
}

export function getViewportPreset(id) {
  return VIEWPORT_PRESETS.find((preset) => preset.id === id) || VIEWPORT_PRESETS[0];
}
