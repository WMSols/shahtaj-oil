# -*- coding: utf-8 -*-
"""Recompute invoiceable qty after switching products to ordered invoicing."""


def migrate(cr, version):
    from odoo import api, SUPERUSER_ID

    env = api.Environment(cr, SUPERUSER_ID, {})
    products = env['product.template'].with_context(active_test=False).search([
        ('sale_ok', '=', True),
    ])
    if products:
        products.write({'invoice_policy': 'order'})
    lines = env['sale.order.line'].search([
        ('state', 'in', ('sale', 'done')),
        ('display_type', '=', False),
    ])
    if lines and hasattr(lines, '_compute_qty_to_invoice'):
        lines._compute_qty_to_invoice()
