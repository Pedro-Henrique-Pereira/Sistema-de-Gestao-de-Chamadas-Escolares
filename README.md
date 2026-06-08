

## Fuso horário oficial

O backend foi configurado para operar sempre no horário de Brasília (`America/Sao_Paulo`), independentemente do fuso horário físico do servidor. Para manter esse comportamento em produção, mantenha no ambiente do backend:

```env
TZ=America/Sao_Paulo
DB_TIMEZONE=-03:00
```

As regras de chamada, atraso, data do dia, relatórios e consultas sensíveis ao horário passam a usar essa referência.
