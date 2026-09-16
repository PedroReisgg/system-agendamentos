export const somenteDigitos=v=>(v||'').replace(/\D/g,'');
export const mascaraCpf=v=>somenteDigitos(v).slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
export const mascaraTelefone=v=>somenteDigitos(v).slice(0,11).replace(/(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2');
export const mascaraCep=v=>somenteDigitos(v).slice(0,8).replace(/(\d{5})(\d)/,'$1-$2');
export function cpfValido(valor){const cpf=somenteDigitos(valor);if(!/^\d{11}$/.test(cpf)||/^(\d)\1+$/.test(cpf))return false;const digito=(base,fator)=>{let total=0;for(let i=0;i<base.length;i++)total+=Number(base[i])*(fator-i);const resto=(total*10)%11;return resto===10?0:resto};return digito(cpf.slice(0,9),10)===Number(cpf[9])&&digito(cpf.slice(0,10),11)===Number(cpf[10]);}
