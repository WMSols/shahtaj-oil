/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class FinancialsInvoicing extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({
            activeSubTab: 'invoices',
            invoiceSubTab: 'orders',
            
            selectedOrder: null, 
            selectedOrderLines: [], 
            
            selectedInvoice: null,
            selectedInvoiceLines: [],
            isEditingInvoice: false,
            isSavingInvoice: false,

            selectedPayment: null,
            selectedShop: null,
            
            showPaymentModal: false,
            paymentForm: { journal_id: '', amount: 0, date: '', invoice_id: null, invoice_name: '' },

            showRefundModal: false,
            refundForm: { journal_id: '', reason: '', date: '' },

            journals: [], 
            
            orders: [],
            invoices: [],
            payments: [],
            balances: [],
            credits: [] 
        });

        onWillStart(async () => {
            await this.fetchRealData();
        });
    }

    async fetchRealData() {
        // 1. Orders to Invoice
        try {
            const ordersData = await this.orm.searchRead(
                "sale.order",
                [["invoice_status", "=", "to invoice"], ["shahtaj_visit_id", "!=", false]],
                [
                    "name", "partner_id", "date_order", "amount_total", "amount_untaxed", 
                    "state", "user_id", "payment_term_id", "pricelist_id", "shahtaj_visit_id"
                ]
            );
            this.state.orders = ordersData.map(o => ({
                id: o.id,
                display_name: o.name,
                shop: o.partner_id ? o.partner_id[1] : 'Unknown',
                shopId: o.partner_id ? o.partner_id[0] : false,
                booker: o.user_id ? o.user_id[1] : 'Unassigned',
                bookerId: o.user_id ? o.user_id[0] : false,
                date: o.date_order ? o.date_order.split(' ')[0] : 'N/A', 
                amount: (o.amount_total || 0).toLocaleString(),
                rawAmount: o.amount_total || 0,
                untaxedAmount: (o.amount_untaxed || 0).toLocaleString(),
                paymentTerms: o.payment_term_id ? o.payment_term_id[1] : 'Immediate',
                pricelist: o.pricelist_id ? o.pricelist_id[1] : 'Default (PKR)',
                visit: o.shahtaj_visit_id ? o.shahtaj_visit_id[1] : 'N/A',
            }));
        } catch (error) { console.error("Orders Fetch Error:", error); }

        // 2. Customer Invoices (FIXED DRAFT 'FALSE' TEXT BUG)
        try {
            const invoicesData = await this.orm.searchRead(
                "account.move",
                [["move_type", "in", ["out_invoice"]], ["partner_id.is_shahtaj_shop", "=", true]],
                ["name", "partner_id", "invoice_date", "amount_total", "payment_state", "state"]
            );
            this.state.invoices = invoicesData.map(inv => ({
                id: inv.id,
                display_name: (inv.name && inv.name !== '/') ? inv.name : `Draft Invoice (*${inv.id})`,
                shop: inv.partner_id ? inv.partner_id[1] : 'Unknown',
                date: inv.invoice_date || 'Not set',
                amount: (inv.amount_total || 0).toLocaleString(),
                rawAmount: inv.amount_total || 0,
                status: inv.state === 'cancel' ? 'Cancelled' : (inv.state === 'draft' ? 'Draft' : (inv.payment_state === 'paid' || inv.payment_state === 'in_payment' ? 'Paid' : 'Posted'))
            }));
        } catch (error) { console.error("Invoices Fetch Error:", error); }

        try {
            this.state.journals = await this.orm.searchRead("account.journal", [["type", "in", ["bank", "cash"]]], ["name", "type"]);
        } catch (error) { console.error("Journals Fetch Error:", error); }

        // 3. Customer Payments (FIXED DRAFT BUG)
        try {
            const paymentsData = await this.orm.searchRead(
                "account.payment",
                [["partner_id.is_shahtaj_shop", "=", true]], 
                ["name", "partner_id", "date", "amount", "journal_id", "memo", "state"]
            );
            this.state.payments = paymentsData.map(pay => ({
                id: pay.id,
                display_name: pay.name ? pay.name : `Processing... (#${pay.id})`,
                shop: pay.partner_id ? pay.partner_id[1] : 'Unknown',
                date: pay.date || 'N/A',
                amount: (pay.amount || 0).toLocaleString(),
                method: pay.journal_id ? pay.journal_id[1] : 'Manual',
                ref: pay.memo || 'N/A', 
                status: pay.state ? pay.state.charAt(0).toUpperCase() + pay.state.slice(1) : 'Draft'
            }));
        } catch (error) { console.error("Payments Fetch Error:", error); }

        // 4. Shop Balances
        try {
            const shopsData = await this.orm.searchRead(
                "res.partner",
                [["is_shahtaj_shop", "=", true], ["shop_approval_state", "=", "approved"]],
                ["name", "owner_name", "route_id", "shahtaj_shop_category", "credit_limit", "credit"] 
            );
            
            this.state.balances = shopsData.map(shop => ({
                id: shop.id,
                shopId: shop.id,
                shop: shop.name,
                owner: shop.owner_name || 'N/A',
                route: shop.route_id ? shop.route_id[1] : 'Unassigned',
                category: shop.shahtaj_shop_category === 'cash' ? 'Cash' : 'Credit',
                limit: shop.shahtaj_shop_category === 'cash'
                    ? 'N/A'
                    : (shop.credit_limit || 0).toLocaleString(),
                rawLimit: shop.credit_limit || 0,
                outstanding: (shop.credit || 0).toLocaleString(), 
            }));

            this.state.credits = shopsData.map(shop => {
                const limit = shop.credit_limit || 0;
                const utilized = shop.credit || 0;
                let status = "Healthy";
                
                if (shop.shahtaj_shop_category === 'cash') {
                    status = "Cash";
                } else if (limit > 0) {
                    if (utilized > limit) status = "Exceeded";
                    else if (utilized >= limit * 0.85) status = "Critical";
                }
                
                return {
                    id: shop.id,
                    shopId: shop.id,
                    shop: shop.name,
                    limit: limit.toLocaleString(),
                    rawLimit: limit,
                    utilized: utilized.toLocaleString(),
                    rawUtilized: utilized,
                    available: Math.max(0, limit - utilized).toLocaleString(),
                    status: status
                };
            });
        } catch (error) { console.error("Shop Balances Fetch Error:", error); }
    }

    setSubTab(tabName) { this.state.activeSubTab = tabName; this.resetDetailViews(); }
    setInvoiceSubTab(subTabName) { this.state.invoiceSubTab = subTabName; this.resetDetailViews(); }
    
    resetDetailViews() {
        this.state.selectedInvoice = null;
        this.state.selectedInvoiceLines = [];
        this.state.isEditingInvoice = false;
        this.state.selectedOrder = null;
        this.state.selectedOrderLines = []; 
        this.state.selectedPayment = null;
        this.state.selectedShop = null;
        this.closePaymentModal();
        this.closeRefundModal();
    }

    async viewOrder(order) { 
        this.state.selectedOrder = order; 
        this.state.selectedOrderLines = []; 
        try {
            const linesData = await this.orm.searchRead(
                "sale.order.line",
                [["order_id", "=", order.id], ["display_type", "=", false]], 
                ["product_id", "product_uom_qty", "qty_delivered", "qty_invoiced", "price_unit", "price_subtotal"]
            );
            this.state.selectedOrderLines = linesData.map(l => ({
                id: l.id,
                product: l.product_id ? l.product_id[1] : 'Unknown Product',
                qty: l.product_uom_qty,
                delivered: l.qty_delivered,
                invoiced: l.qty_invoiced,
                price: (l.price_unit || 0).toLocaleString(),
                subtotal: (l.price_subtotal || 0).toLocaleString()
            }));
        } catch (error) { console.error("Lines Fetch Error:", error); }
    }
    
    async viewInvoice(invoice) { 
        this.state.selectedInvoice = invoice; 
        this.state.selectedInvoiceLines = [];
        this.state.isEditingInvoice = false;
        try {
            const linesData = await this.orm.searchRead(
                "account.move.line",
                [["move_id", "=", invoice.id], ["display_type", "in", ["product", false]]], 
                ["product_id", "quantity", "price_unit", "price_subtotal", "name"]
            );
            this.state.selectedInvoiceLines = linesData.map(l => ({
                id: l.id,
                product: l.product_id ? l.product_id[1] : l.name,
                qty: l.quantity,
                price: l.price_unit,
                subtotal: (l.price_subtotal || 0).toLocaleString()
            }));
        } catch (error) { console.error("Lines Fetch Error:", error); }
    }

    viewPayment(payment) { this.state.selectedPayment = payment; }
    viewShop(shop) { this.state.selectedShop = { ...shop }; }

    async triggerCreateInvoice(order) {
        try {
            const context = { active_model: 'sale.order', active_ids: [order.id] };
            const wizardIds = await this.orm.create("sale.advance.payment.inv", [{ advance_payment_method: 'delivered' }], { context });
            await this.orm.call("sale.advance.payment.inv", "create_invoices", [wizardIds], { context });
            await this.fetchRealData();
            this.setInvoiceSubTab('customer_invoices');
        } catch (error) { 
            alert(`Backend rejected the invoice creation:\n\n${error.data?.message || error.message}`);
        }
    }

    async actionConfirmInvoice(invoice) {
        try {
            await this.orm.call("account.move", "action_post", [[invoice.id]]);
            await this.fetchRealData();
            const updatedInv = this.state.invoices.find(i => i.id === invoice.id);
            if (updatedInv) this.state.selectedInvoice = updatedInv;
        } catch (error) { console.error("Failed to confirm", error); }
    }

    async actionResetToDraft(invoice) {
        try {
            await this.orm.call("account.move", "button_draft", [[invoice.id]]);
            await this.fetchRealData();
            const updatedInv = this.state.invoices.find(i => i.id === invoice.id);
            if (updatedInv) this.state.selectedInvoice = updatedInv;
        } catch (error) { console.error("Failed to reset", error); }
    }

    async actionCancelInvoice(invoice) {
        if (!confirm("Are you sure you want to completely cancel this invoice?")) return;
        try {
            await this.orm.call("account.move", "button_cancel", [[invoice.id]]);
            await this.fetchRealData();
            const updatedInv = this.state.invoices.find(i => i.id === invoice.id);
            if (updatedInv) this.state.selectedInvoice = updatedInv;
        } catch (error) { 
            alert("Failed to cancel invoice: " + (error.data?.message || error.message));
        }
    }

    // --- CUSTOM EDIT INVOICE SPA LOGIC ---
    toggleEditInvoice() {
        this.state.isEditingInvoice = true;
    }

    cancelEditInvoice() {
        this.state.isEditingInvoice = false;
        this.viewInvoice(this.state.selectedInvoice); // Reset data
    }

    async saveInvoiceEdits() {
        this.state.isSavingInvoice = true;
        try {
            for (const line of this.state.selectedInvoiceLines) {
                await this.orm.write("account.move.line", [line.id], {
                    quantity: parseFloat(line.qty) || 0,
                    price_unit: parseFloat(line.price) || 0
                });
            }
            this.state.isEditingInvoice = false;
            await this.fetchRealData();
            
            // Refetch updated lines and totals
            const updatedInv = this.state.invoices.find(i => i.id === this.state.selectedInvoice.id);
            if(updatedInv) {
                await this.viewInvoice(updatedInv);
            }
        } catch (error) {
            alert("Failed to save invoice edits: " + (error.data?.message || error.message));
        }
        this.state.isSavingInvoice = false;
    }

    // --- CUSTOM REFUND SPA LOGIC ---
    openRefundModal() {
        const today = new Date().toISOString().split('T')[0];
        this.state.refundForm = {
            journal_id: this.state.journals.length ? this.state.journals[0].id : '',
            date: today,
            reason: ''
        };
        this.state.showRefundModal = true;
    }

    closeRefundModal() { this.state.showRefundModal = false; }

    async processRefund() {
        try {
            const context = { active_model: 'account.move', active_ids: [this.state.selectedInvoice.id] };
            
            const wizardIds = await this.orm.create("account.move.reversal", [{
                reason: this.state.refundForm.reason,
                date: this.state.refundForm.date,
                journal_id: parseInt(this.state.refundForm.journal_id) || false
            }], { context });
            
            await this.orm.call("account.move.reversal", "reverse_moves", [wizardIds], { context });
            
            await this.fetchRealData(); 
            this.closeRefundModal();
            this.state.selectedInvoice = null; // Exit to main invoice view
            
        } catch (error) {
            alert(`Refund failed:\n\n${error.data?.message || error.message}`);
        }
    }
    async actionPrintInvoice(invoiceId) {
        // Calls the native Odoo PDF generation engine
        this.action.doAction({
            type: 'ir.actions.report',
            report_type: 'qweb-pdf',
            report_name: 'account.report_invoice_with_payments',
            report_file: 'account.report_invoice_with_payments',
            context: { active_ids: [invoiceId] },
        });
    }
    openPaymentModal() {
        const today = new Date().toISOString().split('T')[0];
        this.state.paymentForm = {
            journal_id: this.state.journals.length ? this.state.journals[0].id : '',
            amount: this.state.selectedInvoice.rawAmount,
            date: today,
            invoice_id: this.state.selectedInvoice.id,
            invoice_name: this.state.selectedInvoice.display_name
        };
        this.state.showPaymentModal = true;
    }

    closePaymentModal() { this.state.showPaymentModal = false; }

    async processPayment() {
        try {
            const form = this.state.paymentForm;
            const context = { active_model: 'account.move', active_ids: [form.invoice_id] };
            
            const wizardIds = await this.orm.create("account.payment.register", [{
                journal_id: parseInt(form.journal_id),
                amount: parseFloat(form.amount),
                payment_date: form.date,
            }], { context });
            
            await this.orm.call("account.payment.register", "action_create_payments", [wizardIds], { context });
            
            await this.fetchRealData(); 
            this.closePaymentModal();
            const updatedInv = this.state.invoices.find(i => i.id === this.state.selectedInvoice.id);
            if (updatedInv) this.state.selectedInvoice = updatedInv;
            
        } catch (error) {
            alert(`Payment failed:\n\n${error.data?.message || error.message}`);
        }
    }

    async saveShopBalance() {
        try {
            const shop = this.state.selectedShop;
            await this.orm.write("res.partner", [shop.id], {
                credit_limit: parseFloat(shop.rawLimit)
            });
            await this.fetchRealData();
            this.state.selectedShop = null;
        } catch (error) { 
            alert("Failed to save limit. Ensure you have distributor rights.");
        }
    }
}

FinancialsInvoicing.template = "shahtaj_oil.FinancialsInvoicing";