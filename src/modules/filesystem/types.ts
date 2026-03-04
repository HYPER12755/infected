export type OutputType = 'stdout' | 'stderr' | 'combined' | 'log' | 'all';

export interface FileInfo {
  output_id: string;
  output_type: OutputType;
  name: string;
  size: number;
  created_at: string;
  path: string;
  execution_id?: string;
}
