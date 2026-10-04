export interface GameFilesystem {
  lookupPath(path: string, options?: unknown): unknown;
  mkdir(path: string): void;
  mkdirTree(path: string): void;
  mount(type: unknown, options: { autoPersist: boolean }, path: string): void;
  chdir(path: string): void;
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
}

declare global {
  var FS: GameFilesystem;
  var IDBFS: unknown;
}

export function mountGameFilesystem(
  module: { addRunDependency(name: string): void; removeRunDependency(name: string): void },
  failed: (error: unknown) => void,
) {
  const dependency = "moxi-filesystem";
  module.addRunDependency(dependency);
  try {
    FS.mkdir("app:");
    FS.mount(IDBFS, { autoPersist: true }, "app:");
    // app: is the client's absolute drive, including after we change directory.
    const lookupPath = FS.lookupPath.bind(FS);
    FS.lookupPath = (path, options) =>
      lookupPath(path.startsWith("app:") ? `/${path}` : path, options);
    FS.syncfs(true, (restoreError) => {
      if (restoreError) {
        failed(restoreError);
        return;
      }
      try {
        FS.mkdirTree("app:/Templates/Skills");
        FS.mkdirTree("app:/Templates/Equipment");
        FS.chdir("app:");
        FS.syncfs(false, (persistError) => {
          if (persistError) failed(persistError);
          else {
            console.info("[moxi] persistent filesystem ready");
            module.removeRunDependency(dependency);
          }
        });
      } catch (error) {
        failed(error);
      }
    });
  } catch (error) {
    failed(error);
  }
}
