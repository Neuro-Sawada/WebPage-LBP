fetch("/quotes")
.then(res => res.json())
.then(data => {

    const table = document.getElementById("tableBody");

    data.forEach(q => {

        const row = `
        <tr>
            <td>${q.first_name} ${q.last_name}</td>
            <td>${q.phone}</td>
            <td>${q.email}</td>
            <td>${q.paint_type}</td>
            <td>${q.rooms}</td>
            <td>${q.size}</td>
            <td>$${q.final_price}</td>
            <td>${new Date(q.date).toLocaleString()}</td>
        </tr>
        `;

        table.innerHTML += row;
    });

});
