/** @odoo-module **/

import { Component, useState, onMounted, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { hasFinancialAccess, notifyPortalBusy } from "../../shahtaj_access";
import { formatDate, requestFinancialTabSwitch } from "./financials_cache";
import { setPendingCashDirection } from "./po_prefill";

export class MoneyOverview extends Component {
    static props = {
        refreshNonce: { type: Number, optional: true },
    };

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        this.state = useState({
            activeSubTab: "money",
            money: {
                date_from: formatDate(firstDay),
                date_to: formatDate(today),
                isLoading: true,
                collected: 0, paidOut: 0, netCash: 0, stillOwed: 0,
                openInvoiceAmount: 0, paymentCountIn: 0, paymentCountOut: 0,
            },
        });
        onWillUpdateProps((nextProps) => {
            if (nextProps.refreshNonce !== this.props.refreshNonce) {
                this.loadMoneyOverview();
            }
        });
        this._moneyLoadToken = 0;
        onMounted(() => {
            if (!hasFinancialAccess()) {
                this.state.money.isLoading = false;
                return;
            }
            this.loadMoneyOverview();
        });
    }

    requestTabSwitch(tabName, subTabName) {
        requestFinancialTabSwitch(tabName, subTabName);
    }

    openCashActivity(direction = "all") {
        setPendingCashDirection(direction || "all");
        this.requestTabSwitch("financials", "cash");
    }

    openShopBalancesFromMoney() {
        this.requestTabSwitch("financials", "balances");
    }

    openCreditNotesFromMoney() {
        this.requestTabSwitch("financials", "credit_notes");
    }

    async loadMoneyOverview() {
        const token = ++this._moneyLoadToken;
        const from = this.state.money.date_from;
        const to = this.state.money.date_to;
        this.state.money.isLoading = true;
        notifyPortalBusy(true);
        try {
            const paymentDomain = [
                ["journal_id.type", "in", ["bank", "cash"]],
                ["date", ">=", from],
                ["date", "<=", to],
                ["state", "in", ["paid", "in_process", "posted", "reconciled"]],
            ];
            const [payments, shopsData, invoicesData] = await Promise.all([
                this.orm.searchRead(
                    "account.payment",
                    paymentDomain,
                    ["amount", "amount_signed", "payment_type"]
                ),
                this.orm.searchRead(
                    "res.partner",
                    [["is_shahtaj_shop", "=", true], ["shop_approval_state", "=", "approved"]],
                    ["outstanding_balance"]
                ),
                this.orm.searchRead(
                    "account.move",
                    [
                        ["move_type", "=", "out_invoice"],
                        ["partner_id.is_shahtaj_shop", "=", true],
                        ["state", "=", "posted"],
                        ["payment_state", "in", ["not_paid", "partial"]],
                    ],
                    ["amount_residual"]
                ),
            ]);
            if (token !== this._moneyLoadToken || from !== this.state.money.date_from || to !== this.state.money.date_to) {
                return;
            }

            let collected = 0;
            let paidOut = 0;
            let paymentCountIn = 0;
            let paymentCountOut = 0;
            for (const payment of payments) {
                const amount = Math.abs(payment.amount_signed || payment.amount || 0);
                if (payment.payment_type === "outbound") {
                    paidOut += amount;
                    paymentCountOut += 1;
                } else {
                    collected += amount;
                    paymentCountIn += 1;
                }
            }

            const stillOwed = shopsData.reduce((sum, shop) => sum + (shop.outstanding_balance || 0), 0);
            const openInvoiceAmount = invoicesData.reduce((sum, inv) => sum + (inv.amount_residual || 0), 0);

            this.state.money.collected = collected;
            this.state.money.paidOut = paidOut;
            this.state.money.netCash = collected - paidOut;
            this.state.money.stillOwed = stillOwed;
            this.state.money.openInvoiceAmount = openInvoiceAmount;
            this.state.money.paymentCountIn = paymentCountIn;
            this.state.money.paymentCountOut = paymentCountOut;
        } catch (error) {
            console.error("Money Overview Fetch Error:", error);
            this.notification.add("Failed to load money overview: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            if (token === this._moneyLoadToken) {
                this.state.money.isLoading = false;
            }
            notifyPortalBusy(false);
        }
    }
}

MoneyOverview.template = "shahtaj_oil.FinancialsMoneyOverview";
