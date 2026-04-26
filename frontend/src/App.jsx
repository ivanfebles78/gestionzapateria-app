import { useState } from "react";

export default function App() {
const [gastos, setGastos] = useState([]);
const [modalOpen, setModalOpen] = useState(false);
const [editando, setEditando] = useState(null);
const [form, setForm] = useState({ concepto: "", importe: "" });

const abrirNuevo = () => {
setEditando(null);
setForm({ concepto: "", importe: "" });
setModalOpen(true);
};

const abrirEditar = (gasto) => {
setEditando(gasto.id);
setForm(gasto);
setModalOpen(true);
};

const guardar = () => {
if (!form.concepto || !form.importe) return;

if (editando) {
setGastos(prev => prev.map(g => g.id === editando ? { ...form, id: editando } : g));
} else {
setGastos(prev => [...prev, { ...form, id: Date.now() }]);
}

setModalOpen(false);
};

const eliminar = (id) => {
setGastos(prev => prev.filter(g => g.id !== id));
};

const total = gastos.reduce((acc, g) => acc + Number(g.importe), 0);

return (
<div className="container">
<h1>Gestión de Gastos</h1>
<button onClick={abrirNuevo}>+ Gestionar gastos</button>

<table>
<thead>
<tr>
<th>Concepto</th>
<th>Importe</th>
<th>Acciones</th>
</tr>
</thead>
<tbody>
{gastos.map(g => (
<tr key={g.id}>
<td>{g.concepto}</td>
<td>{Number(g.importe).toLocaleString()} €</td>
<td>
<button onClick={() => abrirEditar(g)}>Editar</button>
<button onClick={() => eliminar(g.id)}>Borrar</button>
</td>
</tr>
))}
</tbody>
</table>

<h2>Total: {total.toLocaleString()} €</h2>

{modalOpen && (
<div className="modal">
<div className="modal-content">
<h3>{editando ? "Editar gasto" : "Nuevo gasto"}</h3>

<input placeholder="Concepto" value={form.concepto}
onChange={(e)=>setForm({...form, concepto:e.target.value})}/>

<input type="number" placeholder="Importe" value={form.importe}
onChange={(e)=>setForm({...form, importe:e.target.value})}/>

<div className="actions">
<button onClick={guardar}>Guardar</button>
<button onClick={()=>setModalOpen(false)}>Cancelar</button>
</div>

</div>
</div>
)}

</div>
);
}
