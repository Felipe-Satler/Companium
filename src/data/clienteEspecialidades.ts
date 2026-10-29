export const clienteEspecialidades: Record<string, string> = {
  "Vista Nova": "Oftalmologia",
  "Ana Bianca": "Cirurgia Plástica",
  "Ana Fernanda": "Reumatologia",
  "Bruno Moura": "Ortopedia",
  "Bruno Veloso": "Ortopedia",
  "Cintia Castro": "Cirurgia Plástica",
  "Douglas Brito": "Ortopedia",
  "Eduardo Magalhães": "Cirurgia Vascular",
  "Elaine Padua": "Cirurgia Vascular",
  "Fabiana Moreno": "Dermatologia",
  "Feliciano Vilela": "Cirurgia Plástica",
  "Fernando Del Rio": "Urologia",
  "Fábio Morais": "Cirurgia Vascular",
  "Lumilaser": "Estética",
  "Gustavo Nobre": "Cirurgia Plástica",
  "Lia Garrido": "Transplante Capilar",
  "ICV": "Cirurgia Vascular",
  "Instituto FISIORA": "Fisioterapia",
  "Luis Fernando": "Cirurgia Plástica",
  "Luis Pacheco": "Ortopedia",
  "Marcelo Antunes": "Ortopedia",
  "Vasculare": "Cirurgia Vascular",
  "Clínica Pellegrini": "Autismo",
  "Rodolfo Ferraz": "Urologia",
  "Rogerio Lacerda": "Blefaroplastia",
  "Odontoprime": "Odontologia",
  "Teo de Oliveira": "Transplante Capilar",
  "Thiago Godinho": "Cirurgia Vascular",
  "Victor Gomide": "Otorrinolaringologia",
  "Clínica Prisma": "Nutrologia",
  "Nakamura Clínica Médica": "Ginecologia",
  "IMS - Serviços Médicos": "Andrologia",
  "Isabella Serra": "Cirurgia Plástica",
  "Diego Cândido": "Ginecologia",
  "Clínica Lumen": "Acupuntura",
  "Rafael Abreu": "Ortopedia",
  "Carlos Sena": "Urologia",
  "Clínica Integralis": "Andrologia",
  "Juliano Patricio": "Cirurgia Vascular",
  "Alcides Furtado": "Cirurgia Vascular",
};

/**
 * Finds the specialty for a client name, doing a case-insensitive
 * and underscore-tolerant lookup.
 */
export function getEspecialidade(clientName: string): string {
  // Direct match
  if (clienteEspecialidades[clientName]) return clienteEspecialidades[clientName];

  // Normalize: replace underscores, trim
  const normalized = clientName.replace(/_/g, " ").trim();
  if (clienteEspecialidades[normalized]) return clienteEspecialidades[normalized];

  // Case-insensitive
  const lower = normalized.toLowerCase();
  for (const [key, val] of Object.entries(clienteEspecialidades)) {
    if (key.toLowerCase() === lower) return val;
  }

  return "-";
}
