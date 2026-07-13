/** @odoo-module **/

import { Component, useState } from "@odoo/owl";

export class BankTransactions extends Component {
    setup() {
        this.state = useState({
            // View Control
            viewMode: 'list', // 'list' or 'detail'
            selectedTransaction: null,

            // Filters
            searchQuery: '',
            filterBank: 'all', // 'all', 'HBL', 'Meezan', 'Alfalah'
            sortBy: 'date_desc', // 'date_desc', 'amount_asc', 'amount_desc'
            dateFrom: '',
            dateTo: '',

            // Static Mock Data
            transactions: [
                { id: 1, date: '2026-07-01', bank: 'HBL', payee: 'Shahtaj Oil Supply', amount: 50000, status: 'Completed', details: 'Bulk fuel supply payment' },
                { id: 2, date: '2026-07-05', bank: 'Meezan', payee: 'Ali Traders', amount: 12500, status: 'Pending', details: 'Office maintenance items' },
                { id: 3, date: '2026-07-08', bank: 'Alfalah', payee: 'Rentals PK', amount: 75000, status: 'Completed', details: 'Warehouse rent July' },
                { id: 4, date: '2026-07-09', bank: 'HBL', payee: 'Fuel Station 09', amount: 3200, status: 'Completed', details: 'Daily fuel top-up' },
            ]
        });
    }

    get filteredTransactions() {
        let list = this.state.transactions.filter(t => {
            // Search
            const matchesSearch = t.payee.toLowerCase().includes(this.state.searchQuery.toLowerCase());
            // Bank Filter
            const matchesBank = this.state.filterBank === 'all' || t.bank === this.state.filterBank;
            // Date Filter
            const matchesDateFrom = !this.state.dateFrom || t.date >= this.state.dateFrom;
            const matchesDateTo = !this.state.dateTo || t.date <= this.state.dateTo;

            return matchesSearch && matchesBank && matchesDateFrom && matchesDateTo;
        });

        // Sorting
        if (this.state.sortBy === 'amount_asc') list.sort((a, b) => a.amount - b.amount);
        if (this.state.sortBy === 'amount_desc') list.sort((a, b) => b.amount - a.amount);
        if (this.state.sortBy === 'date_desc') list.sort((a, b) => new Date(b.date) - new Date(a.date));

        return list;
    }

    viewDetails(transaction) {
        this.state.selectedTransaction = transaction;
        this.state.viewMode = 'detail';
    }

    goBack() {
        this.state.viewMode = 'list';
        this.state.selectedTransaction = null;
    }
}

BankTransactions.template = "shahtaj_oil.BankTransactions";