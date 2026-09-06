export default defineObsidianPlugin((api) => {
  api.registerRibbonIcon('obsidian-iserv', (leaf) => {
    leaf.setText('IServ');
    return leaf;
  });
  return {
    manifest: {
      id: 'iserv-integration',
      name: 'IServ Integration',
      version: '0.1.0',
      minAppVersion: '1.12.2',
    },
  };
});
