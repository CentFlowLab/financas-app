// Estado de interface (não persistido)
import { curMonth } from './util.js';
export const ui = {
  month: curMonth(), // mês do Painel
  mov: { mes: curMonth(), cat: '', conta: '', tipo: '', q: '' }, // filtros dos Movimentos
  fuelVehicle: '',
  chat: [],
};
