declare module "node-pty" {
  interface IPty {
    onData(listener: (data: string) => void): void;
    onExit(listener: (exitCode: number, signal: number) => void): void;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
  }

  interface IWindowsPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }

  function spawn(
    file: string,
    args: string[],
    options: IWindowsPtyForkOptions,
  ): IPty;
}
