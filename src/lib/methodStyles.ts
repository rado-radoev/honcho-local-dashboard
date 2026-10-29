// Shared HTTP method pill styles (Playground endpoint list + detail).
export function methodPillClass(method: string): string {
  if (method === 'POST') return 'bg-green-950 text-green-300'
  if (method === 'GET') return 'bg-blue-950 text-blue-300'
  if (method === 'PUT' || method === 'PATCH') return 'bg-yellow-950 text-yellow-300'
  if (method === 'DELETE') return 'bg-red-950 text-red-300'
  return 'bg-panel-raise text-fog'
}
