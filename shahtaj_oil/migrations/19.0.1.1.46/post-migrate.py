# -*- coding: utf-8 -*-
"""Backfill GPS attempts and switch Shahtaj sale products to invoice on ordered qty."""
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    cr.execute("""
        UPDATE product_template
           SET invoice_policy = 'order'
         WHERE sale_ok IS TRUE
           AND type = 'consu'
           AND invoice_policy IS DISTINCT FROM 'order'
    """)
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['shahtaj.gps.attempt'].backfill_from_existing_visits()
